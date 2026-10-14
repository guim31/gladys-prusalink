// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (see test/fixtures/prusalink/README.md): an MK4-like printer with
// the filament type, an XL printing, PrusaLink on a Raspberry Pi with a camera
// and without /api/printer — three printers at once, in every feature-name
// language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakePrusaLink, PASSWORD, PNG, fixture, until } from './helpers/fakePrusaLink.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

function threePrinters() {
  const mk4 = new FakePrusaLink({ info: null });
  const xl = new FakePrusaLink({ version: fixture('version-xl') });
  xl.setPrinting();
  const pi = new FakePrusaLink({ auth: 'digest-qop', legacy: false });
  pi.status = fixture('status-rpi-camera');
  pi.camera = PNG;
  return [mk4, xl, pi];
}

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language})`, async () => {
    const printers = threePrinters();
    for (const printer of printers) {
      await printer.start();
    }
    const { gladys, stop } = await createWorld({
      printers,
      config: {
        url_1: printers[0].url,
        password_1: PASSWORD,
        url_2: printers[1].url,
        password_2: PASSWORD,
        url_3: printers[2].url,
        password_3: PASSWORD,
        language,
      },
    });
    try {
      await until(
        () =>
          gladys.fake.discoveredDevices.length === 3 &&
          gladys.fake.discoveredDevices[2].features.some((f) => f.category === 'camera'),
      );
      const devices = gladys.fake.discoveredDevices;
      assert.ok(devices[0].features.some((f) => f.external_id.endsWith(':material')));
      assert.ok(!devices[2].features.some((f) => f.external_id.endsWith(':material')));

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(pair.label_en && pair.label_fr && pair.icon, `${at}: couple without label`);

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await stop();
    }
  });
}
