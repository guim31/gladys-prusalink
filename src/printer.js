// -----------------------------------------------------------------------------
// One printer: the reading loop, its latest snapshot, the print events, and
// the commands (pause, resume, cancel).
//
// PrusaLink has no push channel: the container reads `/api/v1/status` every
// 10 s while a print is under way, every 30 s otherwise (Home Assistant reads
// it every 30 s), and once more shortly after a command. The job (file name,
// thumbnail) is read once per job id, the filament type once a minute, the
// printer's identity at each (re)connection.
//
// Events: 'update' (snapshot, previous), 'print' (event), 'capabilities'.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { PrusaLinkClient } from './prusalink/client.js';
import {
  emptySnapshot,
  inPrint,
  isKnown,
  printEvents,
  readIdentity,
  readJob,
  readMaterial,
  readStatus,
} from './prusalink/model.js';

const logger = createLogger({ name: 'prusalink-printer' });

export const DEFAULT_TIMINGS = {
  activeInterval: 10_000,
  idleInterval: 30_000,
  retryInterval: 30_000,
  materialInterval: 60_000,
  identityInterval: 6 * 3600_000,
  afterCommand: 1_500,
};

export const CAMERA_PATH = '/api/v1/cameras/snap';

/** A refused or failed command, with a code the texts translate. */
export class PrinterCommandError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const COMMANDS = {
  pause: { method: 'PUT', path: (id) => `/api/v1/job/${id}/pause` },
  resume: { method: 'PUT', path: (id) => `/api/v1/job/${id}/resume` },
  cancel: { method: 'DELETE', path: (id) => `/api/v1/job/${id}` },
};

export class PrinterLink extends EventEmitter {
  constructor({ slot, url, username, password, fetch, timings, now = Date.now }) {
    super();
    this.slot = slot;
    this.client = new PrusaLinkClient({ baseUrl: url, username, password, fetch });
    this.configured = password !== '';
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.snapshot = emptySnapshot();
    // The last snapshot the printer answered: events compare with it, so a
    // print that ended while the printer was unreachable still fires.
    this.lastKnown = null;
    this.connected = false;
    this.lastError = null;
    this.identity = { name: null, serial: null, version: null };
    this.identityAt = 0;
    this.job = null;
    this.material = null;
    this.materialAt = 0;
    // null: not asked yet; false: the printer has no /api/printer.
    this.materialSupported = null;
    this.camera = false;
    this.timer = null;
    this.running = null;
    // A re-read asked for after a command: a cycle in progress must not push it back.
    this.refreshDue = 0;
    this.jobTried = null;
    this.stopped = false;
  }

  start() {
    this.#schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.removeAllListeners();
  }

  #schedule(delay) {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.refresh().catch((err) => logger.error(`Printer ${this.slot}: read failed`, err));
    }, delay);
    this.timer.unref?.();
  }

  #nextDelay() {
    if (!isKnown(this.snapshot.state)) {
      return this.timings.retryInterval;
    }
    const busy = inPrint(this.snapshot) || this.snapshot.state === 'busy';
    return busy ? this.timings.activeInterval : this.timings.idleInterval;
  }

  /** One reading cycle; concurrent calls share the one in progress. */
  refresh() {
    if (!this.running) {
      const startedAt = this.now();
      this.running = this.#cycle().finally(() => {
        this.running = null;
        let delay = this.#nextDelay();
        if (this.refreshDue > startedAt) {
          delay = Math.min(delay, Math.max(0, this.refreshDue - this.now()));
        } else {
          this.refreshDue = 0;
        }
        this.#schedule(delay);
      });
    }
    return this.running;
  }

  async #cycle() {
    if (!this.configured) {
      this.#publish(emptySnapshot('unauthorized'), 'no password');
      return;
    }
    let status;
    try {
      status = await this.client.getJson('/api/v1/status');
      if (!status || typeof status !== 'object' || !status.printer) {
        throw Object.assign(new Error('PrusaLink sent no printer status'), { kind: 'invalid' });
      }
    } catch (err) {
      const state = err.kind === 'unauthorized' ? 'unauthorized' : 'unreachable';
      if (this.connected || this.lastError !== err.message) {
        logger.debug(`Printer ${this.slot}: ${err.message}`);
      }
      this.connected = false;
      this.#publish(emptySnapshot(state), err.message);
      return;
    }
    const reconnected = !this.connected;
    this.connected = true;

    if (reconnected || this.now() - this.identityAt >= this.timings.identityInterval) {
      await this.#readIdentity();
    }
    const jobId = Number.isInteger(status.job?.id) ? status.job.id : null;
    // Once per job id, even when PrusaLink has nothing to say about it.
    if (jobId !== null && this.jobTried !== jobId) {
      this.jobTried = jobId;
      try {
        this.job = readJob(await this.client.getJson('/api/v1/job'));
      } catch (err) {
        this.jobTried = null;
        logger.debug(`Printer ${this.slot}: no job details (${err.message})`);
      }
    }
    if (
      this.materialSupported !== false &&
      this.now() - this.materialAt >= this.timings.materialInterval
    ) {
      await this.#readMaterial();
    }

    const snapshot = readStatus(status, this.job, this.material);
    this.camera = this.camera || snapshot.camera;
    this.#checkCapabilities();
    for (const event of printEvents(this.lastKnown, snapshot)) {
      this.emit('print', event);
    }
    this.lastKnown = snapshot;
    this.#publish(snapshot, null);
  }

  #publish(snapshot, error) {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    this.lastError = error;
    this.emit('update', snapshot, previous);
  }

  async #readIdentity() {
    this.identityAt = this.now();
    let info = null;
    let version = null;
    try {
      info = await this.client.getJson('/api/v1/info');
    } catch (err) {
      logger.debug(`Printer ${this.slot}: no /api/v1/info (${err.message})`);
    }
    try {
      version = await this.client.getJson('/api/version');
    } catch (err) {
      logger.debug(`Printer ${this.slot}: no /api/version (${err.message})`);
    }
    this.identity = readIdentity(info, version);
    this.camera = this.camera || info?.active_camera === true;
  }

  async #readMaterial() {
    this.materialAt = this.now();
    try {
      this.material = readMaterial(await this.client.getJson('/api/printer'));
      this.materialSupported = true;
    } catch (err) {
      if (err.kind === 'not_found') {
        this.materialSupported = false;
      }
      logger.debug(`Printer ${this.slot}: no filament type (${err.message})`);
    }
  }

  #checkCapabilities() {
    const capabilities = {
      name: this.identity.name,
      camera: this.camera,
      material: this.materialSupported === true,
    };
    this.emit('capabilities', capabilities);
  }

  /**
   * Pause, resume or cancel the current print. Checks the state first: the
   * printer would answer 409 anyway, but the reason is clearer this way.
   */
  async command(name) {
    const command = COMMANDS[name];
    if (!command) {
      throw new Error(`Unknown command ${name}`);
    }
    if (this.snapshot.state === 'unauthorized') {
      throw new PrinterCommandError('unauthorized');
    }
    if (!isKnown(this.snapshot.state)) {
      throw new PrinterCommandError('unreachable');
    }
    const { state, jobId } = this.snapshot;
    if (name === 'pause' && state !== 'printing') {
      throw new PrinterCommandError(state === 'paused' ? 'already_paused' : 'not_printing');
    }
    if (name === 'resume' && state !== 'paused') {
      throw new PrinterCommandError(inPrint(this.snapshot) ? 'not_paused' : 'not_printing');
    }
    if (name === 'cancel' && !inPrint(this.snapshot)) {
      throw new PrinterCommandError('not_printing');
    }
    if (jobId === null) {
      throw new PrinterCommandError('not_printing');
    }
    try {
      await this.client.command(command.method, command.path(jobId));
    } catch (err) {
      if (err.kind === 'conflict' || err.kind === 'not_found') {
        throw new PrinterCommandError(name === 'resume' ? 'not_paused' : 'not_printing');
      }
      if (err.kind === 'unauthorized') {
        throw new PrinterCommandError('unauthorized');
      }
      throw new PrinterCommandError('unreachable', err.message);
    } finally {
      this.refreshDue = this.now() + this.timings.afterCommand;
      this.#schedule(this.timings.afterCommand);
    }
    logger.info(`Printer ${this.slot}: ${name} sent (job ${jobId})`);
  }

  /** A webcam image (PrusaLink on a Raspberry Pi with a camera), or null. */
  cameraImage(maxBytes) {
    return this.client.getImage(CAMERA_PATH, maxBytes);
  }

  /** The thumbnail of the current job, or null. */
  async thumbnailImage(maxBytes) {
    const path = this.snapshot.thumbnail;
    return path ? this.client.getImage(path, maxBytes) : null;
  }
}
