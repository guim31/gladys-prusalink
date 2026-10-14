// -----------------------------------------------------------------------------
// The hub: one PrinterLink per configured printer, and everything Gladys sees
// of them — devices, states, connection status, scene events, commands,
// images.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SLOTS } from './config.js';
import { buildDevice, buildStates, deviceIds, featureKeyOf, slotOf } from './devices.js';
import { PrinterLink } from './printer.js';
import { inPrint, isKnown } from './prusalink/model.js';
import { ProblemLog } from './problems.js';
import {
  NO_FILE,
  SENTENCE,
  STATE_LABELS,
  STATUS_TEXT,
  TEST_TEXT,
  commandMessage,
  formatDuration,
} from './texts.js';

const logger = createLogger({ name: 'prusalink-hub' });

export const WIDGET_KEY = 'printer';

// Scene trigger keys (manifest `scene_triggers`), by print event type.
export const TRIGGERS = {
  started: 'print_started',
  done: 'print_done',
  failed: 'print_failed',
  paused: 'print_paused',
  attention: 'attention_required',
  error: 'printer_error',
};

// The core refuses camera images over 150 KB, the data URI included: the
// base64 of 110 KB plus its prefix stays below.
export const MAX_CAMERA_BYTES = 110 * 1024;
// Widget images: 300 KB decoded at most.
export const MAX_WIDGET_IMAGE_BYTES = 300 * 1024;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;
// A webcam image pushed to Gladys at most once a minute, during a print.
const CAMERA_PUSH_MS = 60_000;
// A value that does not change is sent again twice a day, so that Gladys
// does not show "no recent value" (after 48 h).
const HEARTBEAT_MS = 12 * 3600_000;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language) {
    const message = commandMessage(code);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

export class Hub {
  constructor({ gladys, store, fetch, timings, now = Date.now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.timings = timings;
    this.now = now;
    this.config = { printers: [], invalidSlots: [], language: 'fr' };
    // slot -> { slot, url, username, password, link, capabilities }
    this.printers = new Map();
    // slot -> capabilities known from a previous run (store)
    this.known = {};
    this.lastStatus = '';
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
    // Refusals of Gladys repeated on every update: one line, not one per snapshot.
    this.problems = new ProblemLog(logger);
  }

  get language() {
    return this.config.language;
  }

  async start(config) {
    const saved = await this.store.load();
    this.known = saved && typeof saved.printers === 'object' ? saved.printers : {};
    await this.reconfigure(config);
  }

  /** New configuration: restart the printers whose address or credentials changed. */
  async reconfigure(config) {
    const languageChanged = config.language !== this.config.language;
    this.config = config;
    const wanted = new Map(config.printers.map((p) => [p.slot, p]));
    for (const [slot, printer] of this.printers) {
      const next = wanted.get(slot);
      if (
        !next ||
        next.url !== printer.url ||
        next.username !== printer.username ||
        next.password !== printer.password
      ) {
        printer.link.stop();
        this.printers.delete(slot);
      }
    }
    for (const [slot, settings] of wanted) {
      if (!this.printers.has(slot)) {
        this.#addPrinter(settings);
      }
    }
    await this.publishDevices();
    if (languageChanged) {
      await this.publishAllStates();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
    await this.publishAllStates();
    this.lastStatus = '';
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const printer of this.printers.values()) {
      printer.link.stop();
    }
    clearTimeout(this.widgetTimer);
    return this.store.flush();
  }

  #addPrinter(settings) {
    const { slot, url, username, password } = settings;
    const link = new PrinterLink({
      slot,
      url,
      username,
      password,
      fetch: this.fetch,
      timings: this.timings,
      now: this.now,
    });
    const known = this.known[slot];
    const printer = {
      slot,
      url,
      username,
      password,
      link,
      capabilities: known?.capabilities ?? null,
      cameraAt: 0,
    };
    this.printers.set(slot, printer);
    link.on('capabilities', (capabilities) => this.#onCapabilities(printer, capabilities));
    link.on('update', (snapshot, previous) => this.#onUpdate(printer, snapshot, previous));
    link.on('print', (event) => this.#onPrint(printer, event));
    link.start();
  }

  // --- Devices and states -------------------------------------------------

  /** Every printer that answered once, as Gladys devices. */
  buildDevices() {
    return [...this.printers.values()]
      .filter((printer) => printer.capabilities)
      .sort((a, b) => a.slot - b.slot)
      .map((printer) => buildDevice(this.gladys, printer, this.language));
  }

  async publishDevices() {
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  // Capabilities are sticky: a filament type or a camera seen once stays, so a
  // printer that misses one answer does not make Gladys offer "Update".
  async #onCapabilities(printer, capabilities) {
    const before = printer.capabilities;
    const next = {
      name: capabilities.name ?? before?.name ?? null,
      camera: capabilities.camera || before?.camera === true,
      material: capabilities.material || before?.material === true,
    };
    if (
      before &&
      before.name === next.name &&
      before.camera === next.camera &&
      before.material === next.material
    ) {
      return;
    }
    printer.capabilities = next;
    this.known[printer.slot] = { capabilities: next };
    this.store.save({ printers: this.known });
    if (!before) {
      logger.info(`Printer ${printer.slot}: connected to PrusaLink (${next.name ?? 'no name'})`);
    }
    await this.publishDevices();
  }

  async #onUpdate(printer, snapshot, previous) {
    if (printer.capabilities) {
      await this.#publishStates(printer);
    }
    if (snapshot.state !== previous.state || snapshot.file !== previous.file) {
      this.refreshWidget();
    }
    const error = printer.link.lastError;
    const key = `link:${printer.slot}`;
    if (error) {
      this.problems.fail(key, `Printer ${printer.slot}: ${error}`);
    } else if (!error) {
      this.problems.recover(key, `Printer ${printer.slot}: PrusaLink answers again`);
    }
    if (snapshot.state !== previous.state || error !== printer.lastError) {
      // Deduplicated: only a change of the status reaches Gladys.
      printer.lastError = error;
      await this.updateConnectionStatus();
    }
    if (inPrint(snapshot) && this.now() - printer.cameraAt >= CAMERA_PUSH_MS) {
      await this.#pushCamera(printer);
    }
  }

  async #publishStates(printer) {
    if (!printer.capabilities || this.stopped) {
      return;
    }
    const states = buildStates(this.gladys, printer, printer.link.snapshot, this.language);
    const key = `states:${printer.slot}`;
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      this.problems.fail(
        key,
        `Cannot publish the states of printer ${printer.slot}: ${err.message}`,
      );
      return;
    }
    this.problems.recover(key, `Printer ${printer.slot}: states published again`);
  }

  async publishAllStates() {
    for (const printer of this.printers.values()) {
      await this.#publishStates(printer);
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const printer = this.printers.get(slotOf(this.gladys, device?.external_id));
    if (!printer) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.#publishStates(printer);
    await this.#pushCamera(printer);
    this.refreshWidget();
  }

  // --- Scene events ---------------------------------------------------------

  async #onPrint(printer, event) {
    const key = TRIGGERS[event.type];
    if (!key || !printer.capabilities) {
      return;
    }
    const data = {
      device: deviceIds(this.gladys, printer.slot).device,
      printer: this.deviceName(printer),
      file: event.file ?? '',
      duration: formatDuration(event.seconds, this.language),
      duration_minutes: typeof event.seconds === 'number' ? Math.round(event.seconds / 60) : 0,
    };
    if (event.type === 'failed') {
      data.reason = event.reason;
    }
    if (['failed', 'attention', 'error'].includes(event.type)) {
      data.message = event.message ?? '';
    }
    logger.info(`Printer ${printer.slot}: ${key} (${data.file || 'no file'})`);
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    }
    this.refreshWidget();
  }

  /** The name the user gave the device in Gladys, or the default one. */
  deviceName(printer) {
    const created = (this.gladys.devices ?? []).find(
      (device) => device.external_id === deviceIds(this.gladys, printer.slot).device,
    );
    return (
      created?.name ??
      buildDevice(this.gladys, { ...printer, capabilities: printer.capabilities ?? {} }, 'en').name
    );
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Connection status ----------------------------------------------------

  statusMessage() {
    const lines = Object.fromEntries(Object.keys(STATUS_TEXT).map((language) => [language, []]));
    const add = (key, slot) => {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table[key](slot));
      }
    };
    for (const slot of this.config.invalidSlots) {
      add('invalid', slot);
    }
    for (const slot of SLOTS) {
      const printer = this.printers.get(slot);
      if (!printer) {
        continue;
      }
      if (!printer.link.configured) {
        add('noPassword', slot);
      } else if (printer.link.snapshot.state === 'unauthorized') {
        add('unauthorized', slot);
      } else if (printer.link.snapshot.state === 'unreachable' && printer.link.lastError) {
        // Only once an attempt failed (a fresh start says nothing yet).
        add('unreachable', slot);
      }
    }
    if (this.printers.size === 0 && this.config.invalidSlots.length === 0) {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table.none);
      }
    }
    if (lines.en.length === 0) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 500)]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    const message = this.statusMessage();
    const links = [...this.printers.values()].map((p) => p.link);
    const connected = message === null && links.some((link) => link.connected);
    // A printer still on its first attempt: nothing to say yet.
    if (!connected && message === null && links.some((l) => !l.connected && !l.lastError)) {
      return;
    }
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      this.problems.fail('status', `Cannot set the connection status: ${err.message}`);
      // Not sent: the next update tries again instead of skipping it as unchanged.
      this.lastStatus = '';
      return;
    }
    this.problems.recover('status', 'Connection status set again');
  }

  // --- Commands -----------------------------------------------------------

  printerOf(externalId) {
    const printer = this.printers.get(slotOf(this.gladys, externalId));
    if (!printer) {
      throw new CommandError('unknown_device', this.language);
    }
    return printer;
  }

  /**
   * Pause, resume or cancel the print of a device. Throws a CommandError
   * (coded, multi-language) when the printer refuses it.
   */
  async command(externalId, name) {
    const printer = this.printerOf(externalId);
    try {
      await printer.link.command(name);
    } catch (err) {
      if (err.code) {
        throw new CommandError(err.code, this.language);
      }
      throw err;
    }
    return printer;
  }

  /** onSetValue: the pause and resume buttons (everything else is read only). */
  async setValue(device, feature) {
    const key = featureKeyOf(feature?.external_id);
    if (key !== 'pause' && key !== 'resume') {
      throw new Error(`Feature ${key} cannot be controlled`);
    }
    await this.command(device.external_id, key);
  }

  /** onPoll: the container reads by itself; this only serves a Gladys that would poll. */
  async poll(device) {
    const printer = this.printers.get(slotOf(this.gladys, device?.external_id));
    await printer?.link.refresh();
  }

  /** onGetImage: a fresh webcam image, as a data URI. */
  async getImage(device) {
    const printer = this.printerOf(device?.external_id);
    if (!printer.capabilities?.camera) {
      throw new CommandError('no_camera', this.language);
    }
    const image = await this.#cameraImage(printer);
    return `${image.mime};base64,${image.data.toString('base64')}`;
  }

  async #cameraImage(printer) {
    let image;
    try {
      image = await printer.link.cameraImage(MAX_CAMERA_BYTES);
    } catch (err) {
      if (err.code === 'too_large') {
        throw new CommandError('image_size', this.language);
      }
      if (err.code === 'image_format') {
        throw new CommandError('image_format', this.language);
      }
      if (err.kind === 'not_found') {
        throw new CommandError('no_camera', this.language);
      }
      throw new CommandError('unreachable', this.language);
    }
    if (!image) {
      throw new CommandError('no_camera', this.language);
    }
    return image;
  }

  async #pushCamera(printer) {
    const ids = deviceIds(this.gladys, printer.slot);
    const created = (this.gladys.devices ?? []).some((d) => d.external_id === ids.device);
    if (!created || !printer.link.connected || !printer.capabilities?.camera) {
      return;
    }
    printer.cameraAt = this.now();
    try {
      const image = await this.#cameraImage(printer);
      await this.gladys.publishCameraImage(
        ids.feature('camera'),
        `${image.mime};base64,${image.data.toString('base64')}`,
      );
    } catch (err) {
      this.problems.fail(
        `camera:${printer.slot}`,
        `Printer ${printer.slot}: no camera image (${err.message})`,
      );
      return;
    }
    this.problems.recover(`camera:${printer.slot}`, `Printer ${printer.slot}: camera image again`);
  }

  /**
   * A widget image by key: `cam-<slot>-<n>` (the webcam) or `job-<slot>-<n>`
   * (the thumbnail of the current job). Raw base64, as onWidgetGetImage wants.
   */
  async widgetImage(key) {
    const match = /^(cam|job)-(\d)-/.exec(key ?? '');
    const printer = match ? this.printers.get(Number(match[2])) : null;
    if (!printer) {
      throw new Error(`Unknown image ${key}`);
    }
    const image =
      match[1] === 'cam'
        ? await printer.link.cameraImage(MAX_WIDGET_IMAGE_BYTES)
        : await printer.link.thumbnailImage(MAX_WIDGET_IMAGE_BYTES);
    if (!image) {
      throw new Error(`No image for ${key}`);
    }
    return image.data.toString('base64');
  }

  // --- Reading the state (scene action) ------------------------------------

  /** What the `get_status` scene action returns. */
  status(externalId) {
    const printer = this.printerOf(externalId);
    const language = this.language;
    const snapshot = printer.link.snapshot;
    const label = STATE_LABELS[language][snapshot.state];
    const printing = inPrint(snapshot);
    const percent = Math.round(snapshot.progress ?? 0);
    const left = printing ? formatDuration(snapshot.timeLeft, language) : '';
    const name = this.deviceName(printer);
    const sentence = printing
      ? SENTENCE[language].printing(name, label, snapshot.file ?? NO_FILE[language], percent, left)
      : SENTENCE[language].other(name, label);
    return {
      state: snapshot.state,
      state_label: label,
      sentence,
      file: isKnown(snapshot.state) && snapshot.file ? snapshot.file : '',
      progress: printing ? percent : 0,
      time_left_minutes:
        printing && snapshot.timeLeft !== null ? Math.round(snapshot.timeLeft / 60) : 0,
    };
  }

  // --- "Test the connection" ---------------------------------------------------

  async testReport() {
    if (this.printers.size === 0) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    const lines = Object.fromEntries(Object.keys(TEST_TEXT).map((language) => [language, []]));
    for (const printer of [...this.printers.values()].sort((a, b) => a.slot - b.slot)) {
      await printer.link.refresh().catch(() => {});
      const { state } = printer.link.snapshot;
      const { name, version } = printer.link.identity;
      for (const [language, table] of Object.entries(TEST_TEXT)) {
        const label = STATE_LABELS[language][state];
        lines[language].push(
          isKnown(state)
            ? table.ok(printer.slot, name ?? 'Prusa', version ?? '?', label)
            : table.failed(printer.slot, label),
        );
      }
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ')]),
    );
  }
}
