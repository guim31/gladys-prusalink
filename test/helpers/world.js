// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// simulated printers (real HTTP servers on 127.0.0.1). Store under a
// temporary folder.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakePrusaLink, PASSWORD, until } from './fakePrusaLink.js';

export const FAST_TIMINGS = {
  activeInterval: 40,
  idleInterval: 40,
  retryInterval: 40,
  materialInterval: 0,
  identityInterval: 3600_000,
  afterCommand: 10,
};

/**
 * @param {object} [options]
 * @param {FakePrusaLink[]} [options.printers] simulated printers (default: one, idle)
 * @param {object} [options.config] integration config (default: printer 1 on the first one)
 */
export async function createWorld({
  printers,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'prusalink-test-')),
  timings = FAST_TIMINGS,
  now,
} = {}) {
  const servers = printers ?? [new FakePrusaLink()];
  for (const server of servers) {
    if (!server.url) {
      await server.start();
    }
  }
  const gladys = createFakeGladys({
    config: config ?? { url_1: servers[0].url, password_1: PASSWORD },
    devices,
  });
  const app = registerHandlers(gladys, { store: new Store(dataDir), timings, now });
  const stop = async () => {
    await app.stop();
    await Promise.all(servers.map((server) => server.stop()));
  };
  if (connect) {
    await gladys.connect();
    // The first reading cycle has published the device.
    if (servers.length > 0 && (config === undefined || config.url_1)) {
      await until(() => gladys.fake.discoveredDevices.length > 0).catch(() => {});
    }
  }
  return { gladys, app, hub: app.hub, servers, dataDir, stop };
}

export const deviceId = (slot = 1) => `ext:test-integration:printer:${slot}`;
export const featureId = (key, slot = 1) => `${deviceId(slot)}:${key}`;

/** The device as Gladys stores it once the user added it. */
export function created(gladys, slot = 1) {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(slot));
  return { ...device, id: `id-${slot}`, selector: `printer-${slot}` };
}
