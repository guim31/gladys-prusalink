// -----------------------------------------------------------------------------
// Repeated failures write one line when they start (or change) and one when
// they end, never one per attempt: the debug level keeps the rest.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const defaultLogger = createLogger({ name: 'prusalink' });

export class ProblemLog {
  constructor(log = defaultLogger) {
    this.log = log;
    // key -> message of the problem in progress
    this.active = new Map();
  }

  /** A failure: logged at `level` the first time (or when the message changes), debug after. Returns true when logged. */
  fail(key, message, level = 'warn') {
    if (this.active.get(key) === message) {
      this.log.debug(message);
      return false;
    }
    this.active.set(key, message);
    this.log[level](message);
    return true;
  }

  /** The problem is over: `message` (info) when one was logged, nothing otherwise. Returns true if it was active. */
  recover(key, message) {
    if (!this.active.has(key)) {
      return false;
    }
    this.active.delete(key);
    if (message) {
      this.log.info(message);
    }
    return true;
  }
}
