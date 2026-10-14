// -----------------------------------------------------------------------------
// Printer -> Gladys device, and snapshot -> feature states.
//
// Same couples and same safety doctrine as gladys-octoprint and
// gladys-moonraker (test/gladys-rules.test.js checks them):
// - state, file, filament: text/text (several of them: the dashboard then
//   shows their names);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label;
// - elapsed, left: duration/integer in minutes (duration/decimal is a slider);
// - temperatures and their targets: device-temperature-sensor/decimal, read
//   only. Not temperature-sensor (it would skew the room temperature), not
//   thermostat (a heater must never be settable from the dashboard, HomeKit,
//   Alexa or Google: fire risk). This integration sends no heating command
//   at all;
// - print speed: counter-sensor/integer in percent, read only;
// - pause, resume: button/push, the "Push" row button.
// Cancelling is not a device button: one tap, no confirmation, a ruined
// print. It is offered by the widget (with a confirmation) and the scenes.
//
// Feature keys are forever: `nozzle_target`, never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { inPrint, isKnown } from './prusalink/model.js';
import { NAMES, NO_FILE, NO_MATERIAL, STATE_LABELS } from './texts.js';

export const DEVICE_TYPE = 'printer';

// Display bounds (the highest Prusa nozzle and bed temperatures, with margin).
export const LIMITS = { nozzle: 350, bed: 150 };
const MAX_MINUTES = 100_000; // about 70 days

export const COMMAND_KEYS = ['pause', 'resume'];
export const HEATERS = ['nozzle', 'bed'];

export function deviceIds(gladys, slot) {
  return gladys.externalIds(DEVICE_TYPE, String(slot));
}

export function defaultName(slot, capabilities) {
  if (capabilities?.name) {
    return capabilities.name.slice(0, 60);
  }
  return slot === 1 ? 'Prusa' : `Prusa ${slot}`;
}

/**
 * @param {object} gladys
 * @param {{ slot: number, url: string, capabilities: object }} printer
 * @param {string} language
 */
export function buildDevice(gladys, { slot, url, capabilities }, language) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, slot);
  const feature = (key, name, fields) => ({
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };
  const minutes = {
    category: CAT.DURATION,
    type: TYPE.DURATION.INTEGER,
    unit: UNIT.MINUTES,
    min: 0,
    max: MAX_MINUTES,
  };

  const features = [
    feature('state', names.state, text),
    feature('file', names.file, text),
    feature('progress', names.progress, {
      category: CAT.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    feature('time_elapsed', names.elapsed, minutes),
    feature('time_left', names.left, minutes),
  ];

  for (const heater of HEATERS) {
    const temperature = {
      category: CAT.DEVICE_TEMPERATURE_SENSOR,
      type: TYPE.SENSOR.DECIMAL,
      unit: UNIT.CELSIUS,
      min: 0,
      max: LIMITS[heater],
    };
    features.push(
      feature(`${heater}_temperature`, names[heater], temperature),
      feature(`${heater}_target`, `${names[heater]} (${names.target})`, temperature),
    );
  }

  features.push(
    feature('speed', names.speed, {
      category: CAT.COUNTER_SENSOR,
      type: TYPE.SENSOR.INTEGER,
      unit: UNIT.PERCENT,
      min: 0,
      max: 1000,
    }),
  );
  if (capabilities.material) {
    features.push(feature('material', names.material, text));
  }

  for (const key of COMMAND_KEYS) {
    features.push(
      feature(key, names[key], {
        category: CAT.BUTTON,
        type: TYPE.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
      }),
    );
  }

  if (capabilities.camera) {
    features.push(
      feature('camera', names.camera, {
        category: CAT.CAMERA,
        type: TYPE.CAMERA.IMAGE,
        min: 0,
        max: 0,
      }),
    );
  }

  return {
    name: defaultName(slot, capabilities),
    external_id: ids.device,
    model: 'PrusaLink',
    // Read by the container's own timer (see src/printer.js): Gladys 5.2.0
    // never polls a device created without should_poll (Gladys#3198).
    should_poll: false,
    features,
    params: [{ name: 'PRUSALINK_URL', value: url }],
  };
}

const round = (value) => (value === null ? null : Math.round(value));
const toMinutes = (seconds) => (seconds === null ? null : Math.round(seconds / 60));

/**
 * Feature states of a snapshot, in the publishStates format. Temperatures are
 * whole degrees and durations whole minutes: only changes reach Gladys.
 * Unknown values are left out (Gladys keeps the last one).
 */
export function buildStates(gladys, { slot, capabilities }, snapshot, language) {
  const ids = deviceIds(gladys, slot);
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const addText = (key, text) => {
    states.push({ device_feature_external_id: ids.feature(key), text: String(text).slice(0, 200) });
  };

  addText('state', (STATE_LABELS[language] ?? STATE_LABELS.en)[snapshot.state]);
  if (!isKnown(snapshot.state)) {
    // The printer does not answer: everything else keeps its last value.
    return states;
  }
  addText('file', snapshot.file ?? NO_FILE[language] ?? NO_FILE.en);
  // Without a job, PrusaLink says nothing about progress and times: 0 then.
  add('progress', snapshot.progress === null ? 0 : Math.round(snapshot.progress));
  add('time_elapsed', snapshot.printTime === null ? 0 : toMinutes(snapshot.printTime));
  add('time_left', inPrint(snapshot) ? toMinutes(snapshot.timeLeft) : 0);
  for (const heater of HEATERS) {
    add(`${heater}_temperature`, round(snapshot[heater].actual));
    add(`${heater}_target`, round(snapshot[heater].target));
  }
  add('speed', round(snapshot.speed));
  if (capabilities.material) {
    addText('material', snapshot.material ?? NO_MATERIAL[language] ?? NO_MATERIAL.en);
  }
  return states;
}

/** `ext:...:printer:2` -> 2, or null when the id is not one of ours. */
export function slotOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const slot = Number(externalId.slice(prefix.length).split(':')[0]);
  return Number.isInteger(slot) ? slot : null;
}

/** The feature key of a feature external id (`...:printer:1:nozzle_target` -> `nozzle_target`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
