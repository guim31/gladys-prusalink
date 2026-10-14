// Reading PrusaLink answers and the print events between two snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySnapshot,
  inPrint,
  printEvents,
  readIdentity,
  readJob,
  readMaterial,
  readStatus,
} from '../src/prusalink/model.js';
import { fixture } from './helpers/fakePrusaLink.js';

test('a printing status, with the details of its job', () => {
  const job = readJob(fixture('job-printing'));
  assert.deepEqual(job, {
    id: 129,
    file: 'TabletStand3.bgcode',
    thumbnail: '/thumb/l/usb/TabletStand3~4.BGC',
  });
  const snapshot = readStatus(fixture('status-printing'), job, 'PETG');
  assert.equal(snapshot.state, 'printing');
  assert.equal(snapshot.jobId, 129);
  assert.equal(snapshot.file, 'TabletStand3.bgcode');
  assert.equal(snapshot.progress, 37);
  assert.equal(snapshot.timeLeft, 73020);
  assert.equal(snapshot.printTime, 43987);
  assert.deepEqual(snapshot.bed, { actual: 53.9, target: 85 });
  assert.equal(snapshot.speed, 100);
  assert.equal(snapshot.material, 'PETG');
  assert.equal(snapshot.camera, false);
  assert.ok(inPrint(snapshot));
});

test('the details of another job are not mixed in', () => {
  const snapshot = readStatus(fixture('status-printing'), { id: 3, file: 'old', thumbnail: null });
  assert.equal(snapshot.file, null);
});

test('an idle status, a camera, an unknown state, a missing field', () => {
  const idle = readStatus(fixture('status-idle'));
  assert.equal(idle.state, 'idle');
  assert.equal(idle.jobId, null);
  assert.equal(idle.progress, null);
  assert.ok(!inPrint(idle));
  const pi = readStatus(fixture('status-rpi-camera'));
  assert.equal(pi.state, 'ready');
  assert.equal(pi.camera, true);
  assert.equal(readStatus({ printer: { state: 'SOMETHING_NEW' } }).state, 'busy');
  assert.equal(readStatus({ printer: { state: 'IDLE', temp_bed: 'x' } }).bed.actual, null);
  const sick = readStatus({
    printer: {
      state: 'ERROR',
      status_printer: { ok: false, message: 'Printer is not responding' },
    },
  });
  assert.equal(sick.message, 'Printer is not responding');
});

test('attention is part of a print only with a job', () => {
  const attention = readStatus({ printer: { state: 'ATTENTION' } });
  assert.ok(!inPrint(attention));
  assert.ok(inPrint({ ...attention, jobId: 4 }));
});

test('filament type, identity', () => {
  assert.equal(readMaterial(fixture('printer-legacy')), 'PLA');
  assert.equal(readMaterial({ telemetry: { material: '---' } }), null);
  assert.equal(readMaterial({}), null);
  assert.deepEqual(readIdentity(fixture('info-xl'), fixture('version-xl')), {
    name: 'PrusaXL',
    serial: 'serial-1337',
    version: '6.1.2+11023',
  });
  assert.deepEqual(readIdentity(null, fixture('version-mk4')), {
    name: 'prusa-mk4',
    serial: null,
    version: '2.1.2',
  });
});

const snap = (state, jobId = null, extra = {}) => ({ ...emptySnapshot(state), jobId, ...extra });
const types = (previous, next) => printEvents(previous, next).map((e) => e.reason ?? e.type);

test('print events: starts, pauses, ends, failures', () => {
  assert.deepEqual(types(null, snap('printing', 1)), [], 'first sight fires nothing');
  assert.deepEqual(types(snap('idle'), snap('printing', 1)), ['started']);
  assert.deepEqual(types(snap('printing', 1), snap('paused', 1)), ['paused']);
  assert.deepEqual(types(snap('paused', 1), snap('printing', 1)), [], 'a resume is no start');
  assert.deepEqual(types(snap('printing', 1), snap('attention', 1)), ['attention']);
  assert.deepEqual(types(snap('attention', 1), snap('printing', 1)), []);
  assert.deepEqual(types(snap('printing', 1), snap('finished', 1)), ['done']);
  assert.deepEqual(types(snap('finished', 1), snap('finished', 1)), []);
  assert.deepEqual(types(snap('paused', 1), snap('stopped', 1)), ['cancelled']);
  assert.deepEqual(types(snap('printing', 1), snap('error', 1)), ['error', 'error']);
  assert.deepEqual(
    printEvents(snap('printing', 1), snap('error', 1)).map((e) => e.type),
    ['failed', 'error'],
  );
  assert.deepEqual(types(snap('idle'), snap('error')), ['error'], 'an error out of a print');
  // A short print that started and ended between two reads.
  assert.deepEqual(types(snap('finished', 1), snap('finished', 2)), ['done']);
  assert.deepEqual(types(snap('printing', 1), snap('printing', 2)), ['started']);
  assert.deepEqual(types(snap('printing', 1), snap('unreachable')), []);
});

test('an ending event keeps the file and time of the print', () => {
  const [event] = printEvents(
    snap('printing', 1, { file: 'a.bgcode', printTime: 600 }),
    snap('stopped', 1),
  );
  assert.deepEqual(event, { type: 'failed', reason: 'cancelled', file: 'a.bgcode', seconds: 600 });
});
