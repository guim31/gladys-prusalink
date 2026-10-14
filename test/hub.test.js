// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys, the hub, and simulated
// PrusaLink printers over real HTTP (digest included).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePrusaLink, PASSWORD, PNG, fixture, settle, until } from './helpers/fakePrusaLink.js';
import { createWorld, created, deviceId, featureId } from './helpers/world.js';

const state = (gladys, key, slot) => gladys.fake.lastState(featureId(key, slot));

test('an idle printer becomes a device with its states, read by digest', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(1));
  assert.equal(device.name, 'PrusaXL');
  assert.equal(device.should_poll, false);
  await until(() => state(gladys, 'state') !== undefined);
  assert.equal(state(gladys, 'state'), 'Au repos');
  assert.equal(state(gladys, 'file'), 'Aucun fichier');
  assert.equal(state(gladys, 'nozzle_temperature'), 48);
  assert.equal(state(gladys, 'nozzle_target'), 210);
  assert.equal(state(gladys, 'bed_temperature'), 42);
  assert.equal(state(gladys, 'speed'), 100);
  assert.equal(state(gladys, 'material'), 'PLA');
  assert.equal(state(gladys, 'progress'), 0);
  // Every request after the first challenge is authenticated by digest.
  const statusReads = servers[0].requests.filter((r) => r.path === '/api/v1/status');
  assert.ok(statusReads.length >= 1);
  assert.ok(statusReads.every((r) => r.auth === 'digest' || r.auth === null));
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the container reads by itself, without onPoll (Gladys#3198)', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const before = servers[0].requests.filter((r) => r.path === '/api/v1/status').length;
  servers[0].setPrinting({ progress: 42 });
  await until(() => state(gladys, 'progress') === 42);
  const after = servers[0].requests.filter((r) => r.path === '/api/v1/status').length;
  assert.ok(after > before);
  assert.equal(state(gladys, 'file'), 'TabletStand3.bgcode');
  assert.equal(state(gladys, 'time_left'), Math.round(73020 / 60));
  assert.equal(state(gladys, 'time_elapsed'), Math.round(43987 / 60));
  assert.equal(state(gladys, 'state'), 'Impression');
  assert.equal(gladys.fake.requests.filter((r) => r.path?.includes('poll')).length, 0);
});

test('print events fire the scene triggers, once each', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const [printer] = servers;
  const keys = () => gladys.fake.sceneEvents.map((e) => e.key);
  const step = async (change, key) => {
    change();
    await until(() => keys().includes(key));
  };
  await step(() => printer.setPrinting({ id: 5 }), 'print_started');
  await step(() => printer.setState('PAUSED'), 'print_paused');
  printer.setState('PRINTING');
  await until(() => state(gladys, 'state') === 'Impression');
  await step(() => printer.setState('ATTENTION'), 'attention_required');
  await step(() => printer.setState('FINISHED'), 'print_done');
  await settle(150);
  assert.deepEqual(keys(), ['print_started', 'print_paused', 'attention_required', 'print_done']);
  const done = gladys.fake.sceneEvents.at(-1);
  assert.equal(done.data.device, deviceId(1));
  assert.equal(done.data.printer, 'PrusaXL');
  assert.equal(done.data.file, 'TabletStand3.bgcode');
  assert.equal(done.data.duration_minutes, Math.round(43987 / 60));
});

test('a cancelled print and an error fire print_failed with their reason', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const [printer] = servers;
  const events = () => gladys.fake.sceneEvents;
  printer.setPrinting({ id: 7 });
  await until(() => events().length === 1);
  printer.setState('STOPPED');
  await until(() => events().length === 2);
  assert.equal(events()[1].key, 'print_failed');
  assert.equal(events()[1].data.reason, 'cancelled');
  printer.setPrinting({ id: 8 });
  await until(() => events().length === 3);
  printer.setState('ERROR');
  await until(() => events().length === 5);
  assert.deepEqual(
    events()
      .slice(3)
      .map((e) => [e.key, e.data.reason]),
    [
      ['print_failed', 'error'],
      ['printer_error', undefined],
    ],
  );
});

test('a print that ended while the printer was unreachable still fires', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const [printer] = servers;
  printer.setPrinting();
  await until(() => gladys.fake.sceneEvents.length === 1);
  printer.down = true;
  await until(() => state(gladys, 'state') === 'Imprimante injoignable');
  printer.setState('FINISHED');
  printer.down = false;
  await until(() => gladys.fake.sceneEvents.length === 2);
  assert.equal(gladys.fake.sceneEvents[1].key, 'print_done');
});

test('pause, resume and cancel reach the printer; refusals are coded', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  const [printer] = servers;
  const device = created(gladys);
  const feature = (key) => device.features.find((f) => f.external_id === featureId(key));

  let ack = await gladys.fake.setValue(device, feature('pause'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Aucune impression en cours/);

  printer.setPrinting({ id: 9 });
  await until(() => state(gladys, 'state') === 'Impression');
  ack = await gladys.fake.setValue(device, feature('pause'), 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(printer.status.printer.state, 'PAUSED');
  assert.ok(printer.requests.some((r) => r.method === 'PUT' && r.path === '/api/v1/job/9/pause'));
  await until(() => state(gladys, 'state') === 'En pause');

  ack = await gladys.fake.setValue(device, feature('resume'), 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(printer.status.printer.state, 'PRINTING');
  await until(() => state(gladys, 'state') === 'Impression');

  // No cancel button on the device: one tap would ruin a print.
  assert.equal(feature('cancel'), undefined);
  const scene = await gladys.fake.sceneAction('control_print', {
    device: deviceId(1),
    command: 'cancel',
  });
  assert.deepEqual(scene.data.outputs, { applied: true });
  assert.ok(printer.requests.some((r) => r.method === 'DELETE' && r.path === '/api/v1/job/9'));
  await until(() => state(gladys, 'state') === 'Arrêtée');
  const again = await gladys.fake.sceneAction('control_print', {
    device: deviceId(1),
    command: 'pause',
  });
  assert.deepEqual(again.data.outputs, { applied: false });
});

test('a temperature feature cannot be written: no heating command exists', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys } = world;
  const device = created(gladys);
  for (const f of device.features.filter((f) => f.category.includes('temperature'))) {
    assert.equal(f.read_only, true, f.name);
    assert.equal(f.category, 'device-temperature-sensor');
    const ack = await gladys.fake.setValue(device, f, 200);
    assert.equal(ack.success, false);
  }
  assert.ok(device.features.every((f) => f.read_only || f.category === 'button'));
});

test('a wrong password is reported, never logged, and recovers when fixed', async (t) => {
  const world = await createWorld({
    printers: [new FakePrusaLink()],
    config: undefined,
    connect: false,
  });
  t.after(world.stop);
  const { gladys, servers } = world;
  gladys.fake.config = { url_1: servers[0].url, password_1: 'wrong' };
  await gladys.connect();
  await until(() => gladys.fake.connectionStatus?.connected === false);
  assert.match(gladys.fake.connectionStatus.message.fr, /mot de passe refusé/);
  await gladys.fake.configUpdated({ url_1: servers[0].url, password_1: PASSWORD });
  await until(() => gladys.fake.connectionStatus?.connected === true);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('an older firmware with an API key works with the same field', async (t) => {
  const printer = new FakePrusaLink({ auth: 'apikey' });
  const world = await createWorld({ printers: [printer] });
  t.after(world.stop);
  await until(() => state(world.gladys, 'state') === 'Au repos');
  assert.ok(printer.requests.some((r) => r.auth === 'apikey'));
});

test('PrusaLink on a Raspberry Pi: digest with qop, and its camera', async (t) => {
  const printer = new FakePrusaLink({ auth: 'digest-qop', version: fixture('version-xl') });
  printer.camera = PNG;
  printer.status = fixture('status-rpi-camera');
  const world = await createWorld({ printers: [printer] });
  t.after(world.stop);
  const { gladys } = world;
  await until(() =>
    gladys.fake.discoveredDevices[0]?.features.some((f) => f.external_id === featureId('camera')),
  );
  assert.equal(state(gladys, 'state'), 'Prête');
  const ack = await gladys.fake.getImage(created(gladys));
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.image, /^image\/png;base64,iVBOR/);
  // Pushed to the device once it is added (the core finds its camera feature).
  await gladys.fake.deviceCreated(created(gladys));
  await until(() => gladys.fake.cameraImages.length > 0);
  assert.equal(gladys.fake.cameraImages[0].device_external_id, deviceId(1));
});

test('a command during a slow read is still followed by a quick re-read', async (t) => {
  const world = await createWorld({
    timings: {
      activeInterval: 5000,
      idleInterval: 5000,
      retryInterval: 5000,
      materialInterval: 0,
      identityInterval: 3600_000,
      afterCommand: 20,
    },
  });
  t.after(world.stop);
  const { gladys, servers, hub } = world;
  const [printer] = servers;
  printer.setPrinting({ id: 11 });
  await hub.printers.get(1).link.refresh();
  const link = hub.printers.get(1).link;
  const slow = link.refresh();
  const ack = await gladys.fake.setValue(created(gladys), { external_id: featureId('pause') }, 1);
  assert.equal(ack.success, true, ack.error);
  await slow;
  await until(() => state(gladys, 'state') === 'En pause', 1000);
});

test('a digest nonce that expires is renewed without an error', async (t) => {
  const printer = new FakePrusaLink({ nonceLifetime: 60 });
  const world = await createWorld({ printers: [printer] });
  t.after(world.stop);
  await settle(300);
  assert.ok(world.hub.printers.get(1).link.connected);
  assert.ok(printer.requests.filter((r) => r.auth === 'digest').length > 3);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('onDeviceCreated publishes every state again', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys } = world;
  await until(() => state(gladys, 'state') !== undefined);
  const count = gladys.fake.states.length;
  const device = created(gladys);
  await gladys.fake.deviceCreated(device);
  const republished = gladys.fake.states.slice(count).map((s) => s.device_feature_external_id);
  assert.ok(republished.includes(featureId('state')));
  assert.ok(republished.includes(featureId('nozzle_temperature')));
  assert.ok(gladys.fake.widgetRefreshes.length >= 1);
});

test('get_status reads the state as a sentence and values', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const { gladys, servers } = world;
  servers[0].setPrinting();
  await until(() => state(gladys, 'state') === 'Impression');
  const ack = await gladys.fake.sceneAction('get_status', { device: deviceId(1) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    sentence: 'PrusaXL : Impression, TabletStand3.bgcode, 37 %, encore 20 h 17 min.',
    state: 'printing',
    state_label: 'Impression',
    file: 'TabletStand3.bgcode',
    progress: 37,
    time_left_minutes: 1217,
  });
});

test('test_connection reports each printer', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /^Imprimante 1 : PrusaXL, PrusaLink 2\.1\.2, Au repos\.$/);
});

test('a restart while the printer is off keeps publishing the device', async (t) => {
  const first = await createWorld();
  const { dataDir } = first;
  const url = first.servers[0].url;
  await first.stop();
  const world = await createWorld({
    printers: [],
    config: { url_1: url, password_1: PASSWORD },
    dataDir,
  });
  t.after(world.stop);
  await until(() => world.gladys.fake.discoveredDevices.length === 1);
  assert.equal(world.gladys.fake.discoveredDevices[0].name, 'PrusaXL');
  await until(() => state(world.gladys, 'state') === 'Imprimante injoignable');
});
