// -----------------------------------------------------------------------------
// A PrusaLink simulator: a real HTTP server (node:http, 127.0.0.1, random
// port) answering like the firmware of a Prusa printer, from the recorded
// answers of test/fixtures/prusalink/ (see their README).
//
// Authentication like Prusa-Firmware-Buddy (lib/WUI/nhttp): Digest, realm
// "Printer API", user `maker`, a 16-hex nonce valid `nonceLifetime` ms, no
// qop, `stale=true` for a valid answer to an expired nonce; or `X-Api-Key`.
// `auth: 'digest-qop'` plays PrusaLink on a Raspberry Pi (qop="auth"),
// `auth: 'apikey'` an older firmware (API key only).
//
// `tools/simulator.js` serves it on the network, to try the container
// against a printer.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

export const USERNAME = 'maker';
export const PASSWORD = 'pass-for-tests';
const REALM = 'Printer API';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/prusalink/${name}.json`, import.meta.url), 'utf8'));
export { fixture };

const md5 = (text) => createHash('md5').update(text).digest('hex');

// The smallest valid PNG (1 x 1): what a thumbnail or a camera returns.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function parseAuthorization(header) {
  const match = /^Digest\s+(.*)$/i.exec(header ?? '');
  if (!match) {
    return null;
  }
  const params = {};
  for (const part of match[1].matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi)) {
    params[part[1].toLowerCase()] = part[2] ?? part[3];
  }
  return params;
}

export class FakePrusaLink {
  /**
   * @param {object} [options]
   * @param {'digest' | 'digest-qop' | 'apikey'} [options.auth]
   * @param {string} [options.password]
   * @param {number} [options.nonceLifetime] ms
   * @param {object} [options.version] `/api/version` answer
   * @param {object | null} [options.info] `/api/v1/info` answer (null: 404)
   * @param {boolean} [options.legacy] serve `/api/printer` (filament type)
   */
  constructor({
    auth = 'digest',
    password = PASSWORD,
    nonceLifetime = 300_000,
    version = fixture('version-mk4'),
    info = fixture('info-xl'),
    legacy = true,
  } = {}) {
    this.auth = auth;
    this.password = password;
    this.nonceLifetime = nonceLifetime;
    this.version = version;
    this.info = info;
    this.legacy = legacy;
    this.material = 'PLA';
    this.status = fixture('status-idle');
    this.job = null;
    this.camera = null;
    this.thumbnail = PNG;
    this.nonces = new Map(); // nonce -> issued at
    this.requests = [];
    this.down = false;
    this.server = createServer((req, res) => this.#handle(req, res));
  }

  /** Listen; resolves the base URL. */
  async start(port = 0, host = '127.0.0.1') {
    await new Promise((resolve) => this.server.listen(port, host, resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
    return this.url;
  }

  stop() {
    this.server.closeAllConnections?.();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // --- Scenario helpers ------------------------------------------------------

  setIdle(state = 'IDLE') {
    this.status = fixture('status-idle');
    this.status.printer.state = state;
    this.job = null;
  }

  /** A print of job `id` (the recorded one by default). */
  setPrinting({ id = 129, progress = 37, state = 'PRINTING' } = {}) {
    this.status = fixture('status-printing');
    this.status.job.id = id;
    this.status.job.progress = progress;
    this.status.printer.state = state;
    this.job = { ...fixture('job-printing'), id, state, progress };
  }

  /** Same job, another state (PAUSED, ATTENTION, FINISHED, STOPPED, ERROR...). */
  setState(state) {
    this.status.printer.state = state;
    if (this.job) {
      this.job.state = state;
    }
  }

  // --- HTTP ------------------------------------------------------------------

  #challenge(res, stale = false) {
    const nonce = randomBytes(8).toString('hex');
    this.nonces.set(nonce, Date.now());
    const qop = this.auth === 'digest-qop' ? ', qop="auth", algorithm=MD5' : '';
    res.setHeader(
      'WWW-Authenticate',
      `Digest realm="${REALM}", nonce="${nonce}", stale=${stale ? 'true' : 'false'}${qop}`,
    );
  }

  #authenticate(req, res) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== undefined) {
      if (apiKey === this.password && this.auth === 'apikey') {
        return 'apikey';
      }
      res.setHeader('WWW-Authenticate', `ApiKey realm="${REALM}"`);
      return null;
    }
    if (this.auth === 'apikey') {
      return null;
    }
    const params = parseAuthorization(req.headers.authorization);
    if (!params) {
      this.#challenge(res);
      return null;
    }
    const ha1 = md5(`${params.username}:${REALM}:${this.password}`);
    const ha2 = md5(`${req.method}:${params.uri}`);
    const expected =
      this.auth === 'digest-qop'
        ? md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`)
        : md5(`${ha1}:${params.nonce}:${ha2}`);
    const valid =
      params.username === USERNAME &&
      params.uri === req.url &&
      params.response === expected &&
      // Firmwares before 5.2 refuse an algorithm without qop.
      (this.auth === 'digest-qop' || params.algorithm === undefined);
    const issued = this.nonces.get(params.nonce);
    if (issued !== undefined && Date.now() - issued < this.nonceLifetime) {
      if (valid) {
        return 'digest';
      }
      this.#challenge(res, false);
      return null;
    }
    this.#challenge(res, valid);
    return null;
  }

  #send(res, status, body, type = 'application/json') {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  }

  #handle(req, res) {
    if (this.down) {
      req.socket.destroy();
      return;
    }
    const auth = this.#authenticate(req, res);
    this.requests.push({ method: req.method, path: req.url, auth });
    if (!auth) {
      this.#send(res, 401, { title: 'Unauthorized' });
      return;
    }
    const path = req.url.split('?')[0];
    const job = /^\/api\/v1\/job\/(\d+)(?:\/(pause|resume|continue))?$/.exec(path);
    if (req.method === 'GET' && path === '/api/version') {
      return this.#send(res, 200, this.version);
    }
    if (req.method === 'GET' && path === '/api/v1/info') {
      return this.info ? this.#send(res, 200, this.info) : this.#send(res, 404, {});
    }
    if (req.method === 'GET' && path === '/api/v1/status') {
      const status = structuredClone(this.status);
      if (this.camera) {
        status.camera = { id: 'Ba1kmCbifTa8X' };
      }
      return this.#send(res, 200, status);
    }
    if (req.method === 'GET' && path === '/api/v1/job') {
      return this.job ? this.#send(res, 200, this.job) : this.#send(res, 204);
    }
    if (req.method === 'GET' && path === '/api/printer') {
      return this.legacy
        ? this.#send(res, 200, { telemetry: { material: this.material } })
        : this.#send(res, 404, {});
    }
    if (req.method === 'GET' && path.startsWith('/thumb/')) {
      return this.#send(res, 200, this.thumbnail, 'image/png');
    }
    if (req.method === 'GET' && path === '/api/v1/cameras/snap') {
      return this.camera ? this.#send(res, 200, this.camera, 'image/png') : this.#send(res, 204);
    }
    if (job) {
      const id = Number(job[1]);
      if (!this.job || this.job.id !== id) {
        return this.#send(res, 404, {});
      }
      const state = this.status.printer.state;
      if (req.method === 'PUT' && job[2] === 'pause' && state === 'PRINTING') {
        this.setState('PAUSED');
        return this.#send(res, 204);
      }
      if (req.method === 'PUT' && job[2] === 'resume' && state === 'PAUSED') {
        this.setState('PRINTING');
        return this.#send(res, 204);
      }
      if (
        req.method === 'DELETE' &&
        !job[2] &&
        ['PRINTING', 'PAUSED', 'ATTENTION'].includes(state)
      ) {
        this.setState('STOPPED');
        return this.#send(res, 204);
      }
      return this.#send(res, 409, { title: 'Conflict' });
    }
    return this.#send(res, 404, {});
  }
}

/** Let the pending reads and publications run. */
export const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `predicate()` holds (polling), or fail after `timeout` ms. */
export async function until(predicate, timeout = 2000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for a condition');
    }
    await settle(10);
  }
}
