// What reaches `docker logs` at the default level (info): the lifecycle only.
// A normal cycle (reads, published states, print events aside) writes nothing
// at info, a repeated failure logs one line, and its recovery one more. The
// password never appears, even in debug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePrusaLink, PASSWORD, settle, until } from './helpers/fakePrusaLink.js';
import { captureLogs } from './helpers/logs.js';
import { createWorld, created } from './helpers/world.js';

const ours = (lines) => lines.filter((line) => line.includes('[prusalink-'));
const atInfo = (lines) => ours(lines).filter((line) => !line.includes('[DEBUG]'));

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t, 'debug');
  const world = await createWorld();
  t.after(world.stop);
  await world.gladys.fake.deviceCreated(created(world.gladys));
  const start = atInfo(logs.lines);
  assert.ok(start.length <= 2, start.join('\n'));
  logs.lines.splice(0);
  await settle(300);
  await world.gladys.fake.poll(created(world.gladys));
  assert.deepEqual(atInfo(logs.lines), []);
  assert.ok(logs.lines.every((line) => !line.includes(PASSWORD)));
});

test('a printer down: one warning, nothing per attempt, one line when it is back', async (t) => {
  const logs = captureLogs(t, 'debug');
  const printer = new FakePrusaLink();
  const world = await createWorld({ printers: [printer] });
  t.after(world.stop);
  logs.lines.splice(0);
  printer.down = true;
  await until(() => world.hub.printers.get(1).link.snapshot.state === 'unreachable');
  await settle(300);
  printer.down = false;
  await until(() => world.hub.printers.get(1).link.connected);
  await settle(50);
  const lines = atInfo(logs.lines);
  assert.equal(lines.filter((l) => l.includes('[WARN]')).length, 1, lines.join('\n'));
  assert.equal(lines.filter((l) => /answers again/.test(l)).length, 1, lines.join('\n'));
  assert.ok(lines.length <= 3, lines.join('\n'));
  assert.ok(logs.lines.every((line) => !line.includes(PASSWORD)));
});
