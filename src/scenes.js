// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A refused command (nothing to pause, nothing to resume) is not an error of
// the scene: the action resolves `applied: false`, so the scene can go on or
// test it. An unreachable printer, a refused password, or an unknown printer,
// throws (the action fails, the scene continues and logs it).
//
// The triggers (`print_started`, `print_done`...) are fired by the hub from
// what the printer reports, never as an echo of these actions.
// No action heats anything (see src/devices.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CommandError } from './hub.js';

const logger = createLogger({ name: 'prusalink-scenes' });

export const PRINT_COMMANDS = ['pause', 'resume', 'cancel'];

const REFUSALS = new Set(['not_printing', 'not_paused', 'already_paused']);

export const SCENE_ACTIONS = {
  async control_print(hub, { fields }) {
    const command = fields.command;
    if (!PRINT_COMMANDS.includes(command)) {
      throw new Error(`Unknown print command ${command}`);
    }
    try {
      await hub.command(fields.device, command);
      return { applied: true };
    } catch (err) {
      if (err instanceof CommandError && REFUSALS.has(err.code)) {
        logger.info(`control_print ${command}: not applied (${err.code})`);
        return { applied: false };
      }
      throw err;
    }
  },

  get_status(hub, { fields }) {
    return hub.status(fields.device);
  },
};
