// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  SLOTS,
  passwordKey,
  urlKey,
  usernameKey,
} from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { PRINT_COMMANDS, SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { until } from './helpers/fakePrusaLink.js';
import { createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, local transport, appliances category', () => {
  assert.equal(manifest.name, 'PrusaLink');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-prusalink:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-prusalink/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['appliances']);
  assert.equal(manifest.network_discovery, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget button opens a form: 5.2.0 is not needed.
  assert.ok(!isAtLeast(minGladysVersion(), [5, 2, 0]), 'keep 5.1 users');
});

test('config_schema: three printer slots, the defaults and options of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  for (const slot of SLOTS) {
    assert.equal(field(urlKey(slot)).type, 'string');
    assert.equal(field(usernameKey(slot)).type, 'string');
    assert.equal(field(passwordKey(slot)).type, 'secret');
    assert.equal(field(passwordKey(slot)).required, false);
  }
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[f.key], f.default, `default of ${f.key}`);
    }
  }
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), [...keys].sort());
  const languages = field('language');
  assert.deepEqual(
    languages.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(languages.default, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const fake = world.gladys.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    const ack = await fake.sceneAction(action.key, { device: 'unknown' });
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields and outputs are the ones the code reads and returns', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const control = manifest.scene_actions.find((a) => a.key === 'control_print');
  assert.deepEqual(
    control.fields.find((f) => f.key === 'command').options.map((o) => o.value),
    PRINT_COMMANDS,
  );
  for (const action of manifest.scene_actions) {
    const ack = await world.gladys.fake.sceneAction(action.key, {
      device: deviceId(1),
      command: 'pause',
    });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      action.key,
    );
    for (const output of action.outputs) {
      const value = ack.data.outputs[output.key];
      assert.equal(typeof value, output.type, `${action.key}.${output.key}`);
    }
  }
});

test('the scene triggers the hub fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(world.stop);
  const [printer] = world.servers;
  const fired = () => world.gladys.fake.sceneEvents.map((e) => e.key);
  const go = async (change, key) => {
    change();
    await until(() => fired().includes(key));
  };
  await go(() => printer.setPrinting({ id: 1 }), 'print_started');
  await go(() => printer.setState('PAUSED'), 'print_paused');
  await go(() => printer.setState('ATTENTION'), 'attention_required');
  await go(() => printer.setState('ERROR'), 'printer_error');
  await go(() => printer.setPrinting({ id: 2 }), 'print_started');
  await go(() => printer.setState('FINISHED'), 'print_done');
  const events = world.gladys.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const variable of trigger.variables) {
      const value = event.data[variable.key];
      assert.equal(typeof value, variable.type === 'number' ? 'number' : 'string', variable.key);
    }
  }
  const reasons = manifest.scene_triggers
    .find((t) => t.key === 'print_failed')
    .fields.find((f) => f.key === 'reason')
    .options.map((o) => o.value);
  assert.deepEqual(reasons, ['cancelled', 'error']);
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.notEqual(field.required, true, `${action.key}.${field.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
