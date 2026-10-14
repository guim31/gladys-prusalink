// The `printer` dashboard widget: contents checked with the SDK validator (the
// core's vocabulary and budget), live tiles cross-checked with the discovered
// devices (the validator does not know them), image, buttons by state, actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { FakePrusaLink, PNG, fixture, until } from './helpers/fakePrusaLink.js';
import { createWorld, deviceId } from './helpers/world.js';

const get = async (world, settings, language = 'en', units = 'metric') => {
  const ack = await world.gladys.fake.widgetGet('printer', { settings, language, units });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

function assertLinkedFeatures(world, content) {
  const features = new Set(
    world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  for (const component of content.components) {
    if (component.device_feature) {
      assert.ok(features.has(component.device_feature), `${component.device_feature} exists`);
    }
  }
}

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);
const status = (content) =>
  Object.fromEntries(
    content.components.find((c) => c.type === 'status').items.map((i) => [i.label, i.value]),
  );
const stateOf = (world) => world.hub.printers.get(1).link.snapshot.state;

test('without a printer, or with an unknown one, the widget says what to do', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  for (const [settings, pattern] of [
    [{}, /Choose a Prusa printer/],
    [{ device: deviceId(3) }, /not configured/],
  ]) {
    const content = await get(world, settings);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.match(content.components[0].text, pattern);
  }
  assert.match((await get(world, {}, 'de')).components[0].text, /Wähle einen Prusa-Drucker/);
});

test('every state renders within the budget, with the buttons that make sense', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const [printer] = world.servers;
  const settings = { device: deviceId(1) };
  const cases = [
    ['idle', () => printer.setIdle('IDLE'), []],
    ['printing', () => printer.setPrinting(), ['pause', 'cancel']],
    ['paused', () => printer.setState('PAUSED'), ['resume', 'cancel']],
    ['attention', () => printer.setState('ATTENTION'), ['cancel']],
    ['finished', () => printer.setState('FINISHED'), []],
    ['error', () => printer.setIdle('ERROR'), []],
  ];
  for (const [state, change, expected] of cases) {
    change();
    await until(() => stateOf(world) === state);
    for (const language of ['en', 'fr', 'de', 'es']) {
      const content = await get(world, settings, language, 'us');
      assert.deepEqual(validateWidgetContent(content), [], `${state} ${language}`);
      assert.ok(content.components.length <= 8);
      assertLinkedFeatures(world, content);
      assert.deepEqual(buttons(content), expected, state);
    }
  }
  printer.setPrinting();
  await until(() => stateOf(world) === 'printing');
  const content = await get(world, settings, 'fr');
  const button = content.components.find((c) => c.type === 'button' && c.action.key === 'cancel');
  assert.equal(button.action.confirm, true, 'cancelling asks first');
  assert.equal(status(content)['Fichier'], 'TabletStand3.bgcode');
  assert.equal(status(content)['Filament'], 'PLA');
  assert.equal(status(content)['Consignes'], '85 °C');
  // The thumbnail of the job, served by onWidgetGetImage.
  const image = content.components.find((c) => c.type === 'image');
  assert.match(image.key, /^job-1-/);
  const ack = await world.gladys.fake.widgetGetImage(image.key);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetImage(ack.data.image), []);
});

test('a printer with a camera shows its image', async (t) => {
  const printer = new FakePrusaLink({ auth: 'digest-qop' });
  printer.status = fixture('status-rpi-camera');
  printer.camera = PNG;
  const world = await createWorld({ printers: [printer] });
  t.after(world.stop);
  await until(() => world.hub.printers.get(1).capabilities?.camera === true);
  const content = await get(world, { device: deviceId(1) });
  const image = content.components.find((c) => c.type === 'image');
  assert.match(image.key, /^cam-1-\d+$/);
  const ack = await world.gladys.fake.widgetGetImage(image.key);
  assert.equal(ack.success, true, ack.error);
});

test('widget buttons act on the print; a refusal is a toast, not an error', async (t) => {
  const world = await createWorld();
  t.after(world.stop);
  const [printer] = world.servers;
  const settings = { device: deviceId(1) };
  let ack = await world.gladys.fake.widgetAction('printer', 'pause', {}, { settings });
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Aucune impression en cours.');
  printer.setPrinting();
  await until(() => stateOf(world) === 'printing');
  ack = await world.gladys.fake.widgetAction('printer', 'pause', {}, { settings });
  assert.equal(ack.data.message.en, 'Pause requested.');
  assert.equal(printer.status.printer.state, 'PAUSED');
  ack = await world.gladys.fake.widgetAction('printer', 'cancel', {}, { settings });
  assert.equal(ack.data.message.de, 'Abbruch angefordert.');
  assert.equal(printer.status.printer.state, 'STOPPED');
});
