// -----------------------------------------------------------------------------
// PrusaLink answers -> snapshots, and the print events read from two
// successive snapshots.
//
// Shapes: Prusa-Link-Web `spec/openapi.yaml` (facts only, the spec is GPL),
// pyprusalink's types and Home Assistant's test fixtures (Apache-2.0).
// `/api/v1/status` is the only call of every cycle: `printer.state` is one of
// IDLE, BUSY, PRINTING, PAUSED, FINISHED, STOPPED, ERROR, ATTENTION, READY,
// every other value is optional; `job` (id, progress, time_remaining,
// time_printing) is there while a job exists. `/api/v1/job` (204 without job)
// gives the file name and its thumbnail, read once per job id.
// -----------------------------------------------------------------------------

/** Every state of a snapshot, the two first ones being ours. */
export const STATES = [
  'unreachable',
  'unauthorized',
  'idle',
  'ready',
  'busy',
  'printing',
  'paused',
  'attention',
  'finished',
  'stopped',
  'error',
];

const PRUSA_STATES = new Set([
  'IDLE',
  'READY',
  'BUSY',
  'PRINTING',
  'PAUSED',
  'ATTENTION',
  'FINISHED',
  'STOPPED',
  'ERROR',
]);

/** The printer answers (any state of the printer itself). */
export const isKnown = (state) => state !== 'unreachable' && state !== 'unauthorized';

/**
 * A print is under way: printing, paused, or waiting for the user in the
 * middle of a job (filament runout, a dialog on the screen).
 */
export function inPrint(snapshot) {
  if (snapshot.state === 'printing' || snapshot.state === 'paused') {
    return true;
  }
  return snapshot.state === 'attention' && snapshot.jobId !== null;
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value) => {
  const n = number(value);
  return n !== null && n >= 0 ? n : null;
};

export function emptySnapshot(state = 'unreachable') {
  return {
    state,
    jobId: null,
    file: null,
    thumbnail: null,
    progress: null,
    printTime: null,
    timeLeft: null,
    nozzle: { actual: null, target: null },
    bed: { actual: null, target: null },
    speed: null,
    material: null,
    message: null,
    camera: false,
  };
}

/**
 * @param {object} status the `/api/v1/status` answer
 * @param {{ id: number, file: string | null, thumbnail: string | null } | null} job
 *   what `/api/v1/job` said about the current job id (null when unknown)
 * @param {string | null} material the last filament type read
 */
export function readStatus(status, job = null, material = null) {
  const printer = status?.printer ?? {};
  const raw = typeof printer.state === 'string' ? printer.state.toUpperCase() : '';
  const snapshot = emptySnapshot(PRUSA_STATES.has(raw) ? raw.toLowerCase() : 'busy');
  const statusJob = status?.job && typeof status.job === 'object' ? status.job : null;
  snapshot.jobId = Number.isInteger(statusJob?.id) ? statusJob.id : null;
  if (snapshot.jobId !== null && job && job.id === snapshot.jobId) {
    snapshot.file = job.file;
    snapshot.thumbnail = job.thumbnail;
  }
  if (statusJob) {
    const progress = positive(statusJob.progress);
    snapshot.progress = progress === null ? null : Math.min(progress, 100);
    snapshot.printTime = positive(statusJob.time_printing);
    snapshot.timeLeft = positive(statusJob.time_remaining);
  }
  snapshot.nozzle = { actual: number(printer.temp_nozzle), target: number(printer.target_nozzle) };
  snapshot.bed = { actual: number(printer.temp_bed), target: number(printer.target_bed) };
  snapshot.speed = positive(printer.speed);
  snapshot.material = material;
  // `status_printer` (PrusaLink on a Raspberry Pi) says why the printer is
  // not ok: "Printer is not responding", a firmware message...
  const health = printer.status_printer;
  if (health && health.ok === false && typeof health.message === 'string' && health.message) {
    snapshot.message = health.message.slice(0, 200);
  }
  snapshot.camera = typeof status?.camera?.id === 'string' && status.camera.id !== '';
  return snapshot;
}

/** What `/api/v1/job` says that the status does not: the file and its thumbnail. */
export function readJob(job) {
  if (!job || !Number.isInteger(job.id)) {
    return null;
  }
  const file = job.file && typeof job.file === 'object' ? job.file : null;
  const name = file?.display_name || file?.name || null;
  const thumbnail = file?.refs?.thumbnail || file?.refs?.icon || null;
  return {
    id: job.id,
    file: typeof name === 'string' ? name.slice(0, 200) : null,
    thumbnail: typeof thumbnail === 'string' && thumbnail.startsWith('/') ? thumbnail : null,
  };
}

/** The filament type of the legacy `/api/printer` (`telemetry.material`). */
export function readMaterial(printer) {
  const material = printer?.telemetry?.material;
  if (typeof material !== 'string') {
    return null;
  }
  const text = material.trim();
  // The firmware says "---" when no filament is loaded.
  return text === '' || /^-+$/.test(text) ? null : text.slice(0, 40);
}

/** Name, serial, versions: `/api/v1/info` and `/api/version`. */
export function readIdentity(info, version) {
  const string = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    name: string(info?.name) ?? string(info?.hostname) ?? string(version?.hostname),
    serial: string(info?.serial),
    version:
      string(version?.firmware) ?? string(version?.version) ?? string(version?.server) ?? null,
  };
}

/**
 * The print events between two snapshots the printer answered: `started`,
 * `paused`, `attention`, `done`, `failed` (reason `cancelled` or `error`) and
 * `error` (the printer entered its error state, in a print or not).
 * A state seen for the first time (`previous` null) fires nothing.
 */
export function printEvents(previous, next) {
  if (!previous || !isKnown(previous.state) || !isKnown(next.state)) {
    return [];
  }
  const events = [];
  const was = inPrint(previous);
  const newJob = next.jobId !== null && next.jobId !== previous.jobId;
  const entered = (state) => next.state === state && (previous.state !== state || newJob);
  const fallback = {
    file: next.file ?? previous.file,
    seconds: next.printTime ?? previous.printTime,
  };

  if (entered('printing') && (!was || newJob)) {
    events.push({ type: 'started', ...fallback });
  }
  if (entered('paused')) {
    events.push({ type: 'paused', ...fallback });
  }
  if (entered('attention')) {
    events.push({ type: 'attention', ...fallback, message: next.message });
  }
  // A short print may start and end between two reads: a new job id counts.
  if (entered('finished') && (was || newJob)) {
    events.push({ type: 'done', ...fallback });
  }
  if (entered('stopped') && (was || newJob)) {
    events.push({ type: 'failed', reason: 'cancelled', ...fallback });
  }
  if (entered('error')) {
    if (was) {
      events.push({ type: 'failed', reason: 'error', ...fallback, message: next.message });
    }
    events.push({ type: 'error', ...fallback, message: next.message });
  }
  return events;
}
