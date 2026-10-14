// -----------------------------------------------------------------------------
// HTTP client of the PrusaLink API (API v1: /api/v1/status, /api/v1/job...).
//
// Authentication: HTTP Digest (RFC 7616, MD5), user `maker` and the password
// shown on the printer (Settings > Network > PrusaLink). The firmware of the
// MK4, Core One, XL and MINI answers a challenge without `qop`
// (`Digest realm="Printer API", nonce="<16 hex>", stale=false`), a nonce lives
// 300 s, and firmwares before 5.2 refuse a header that names its
// `algorithm` when there is no qop (pyprusalink's workaround, kept here).
// PrusaLink on a Raspberry Pi may send `qop="auth"`: both are handled.
// Older firmwares authenticate with an `X-Api-Key` header instead: when the
// digest is refused, the same secret is tried once as an API key, and the
// mode that worked is kept.
//
// Errors are sorted into the few kinds the rest of the integration acts upon,
// and their messages never contain the password.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 8_000;

export class PrusaLinkError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'conflict' | 'not_found' | 'http' | 'invalid'} kind
   * @param {string} message
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'PrusaLinkError';
    this.kind = kind;
    this.status = status;
  }
}

function kindOfStatus(status) {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 409) {
    return 'conflict';
  }
  return 'http';
}

const md5 = (text) => createHash('md5').update(text).digest('hex');

/**
 * Parse a `WWW-Authenticate: Digest ...` header. Returns null for any other scheme.
 * @param {string | null} header
 */
export function parseDigestChallenge(header) {
  if (typeof header !== 'string') {
    return null;
  }
  const match = header.match(/(?:^|,\s*)Digest\s+(.*)$/i);
  if (!match) {
    return null;
  }
  const params = {};
  const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;
  let part;
  while ((part = re.exec(match[1])) !== null) {
    params[part[1].toLowerCase()] =
      part[2] !== undefined ? part[2].replace(/\\(.)/g, '$1') : part[3];
  }
  if (!params.nonce || params.realm === undefined) {
    return null;
  }
  const qops = (params.qop ?? '')
    .split(',')
    .map((q) => q.trim().toLowerCase())
    .filter(Boolean);
  return {
    realm: params.realm,
    nonce: params.nonce,
    opaque: params.opaque,
    algorithm: params.algorithm,
    qop: qops.includes('auth') ? 'auth' : null,
    stale: String(params.stale).toLowerCase() === 'true',
  };
}

/**
 * The `Authorization` header answering a challenge (MD5 only, the only
 * algorithm PrusaLink offers).
 */
export function digestHeader({ challenge, username, password, method, uri, nc = 1, cnonce }) {
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const quote = (value) => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
  ];
  let response;
  if (challenge.qop) {
    const count = nc.toString(16).padStart(8, '0');
    response = md5(`${ha1}:${challenge.nonce}:${count}:${cnonce}:auth:${ha2}`);
    parts.push(`qop=auth`, `nc=${count}`, `cnonce=${quote(cnonce)}`);
    if (challenge.algorithm) {
      parts.push(`algorithm=${challenge.algorithm}`);
    }
  } else {
    // No `algorithm` here: firmwares before 5.2 refuse it (see above).
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }
  parts.push(`response=${quote(response)}`);
  if (challenge.opaque !== undefined) {
    parts.push(`opaque=${quote(challenge.opaque)}`);
  }
  return `Digest ${parts.join(', ')}`;
}

export class PrusaLinkClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl normalized base URL (see normalizeUrl)
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout] per-request timeout, in ms
   */
  constructor({
    baseUrl,
    username = 'maker',
    password = '',
    fetch = globalThis.fetch,
    timeout = DEFAULT_TIMEOUT_MS,
  }) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.fetch = fetch;
    this.timeout = timeout;
    // 'digest' until the printer proves it wants an API key.
    this.mode = 'digest';
    this.challenge = null;
    this.nc = 0;
  }

  #authorization(method, uri) {
    if (this.mode === 'apikey' || !this.challenge) {
      return {};
    }
    this.nc += 1;
    return {
      Authorization: digestHeader({
        challenge: this.challenge,
        username: this.username,
        password: this.password,
        method,
        uri,
        nc: this.nc,
        cnonce: randomBytes(8).toString('hex'),
      }),
    };
  }

  async #fetch(method, path, headers) {
    try {
      return await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'manual',
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new PrusaLinkError('unreachable', `PrusaLink unreachable (${reason})`);
    }
  }

  /**
   * One request, authenticated. Resolves the Response (2xx); throws a
   * PrusaLinkError otherwise.
   */
  async #send(method, path, accept) {
    // The digest covers the path as sent on the request line.
    const target = new URL(`${this.baseUrl}${path}`);
    const uri = `${target.pathname}${target.search}`;
    const base = { Accept: accept };
    const apiKeyHeaders = () => ({ ...base, 'X-Api-Key': this.password });

    let response = await this.#fetch(
      method,
      path,
      this.mode === 'apikey' ? apiKeyHeaders() : { ...base, ...this.#authorization(method, uri) },
    );
    if (response.status === 401 && this.mode === 'digest') {
      await response.body?.cancel();
      const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
      if (challenge) {
        // First request, expired nonce (stale), or a new one after a refusal:
        // answer the fresh challenge once.
        this.challenge = challenge;
        this.nc = 0;
        response = await this.#fetch(method, path, {
          ...base,
          ...this.#authorization(method, uri),
        });
        if (response.status === 401) {
          // A fresh nonce did not help: the password is wrong — or the
          // printer wants an API key. Try that once.
          await response.body?.cancel();
          response = await this.#fetch(method, path, apiKeyHeaders());
          if (response.ok) {
            this.mode = 'apikey';
          }
        }
      } else {
        // No digest challenge at all: an API key printer.
        response = await this.#fetch(method, path, apiKeyHeaders());
        if (response.ok) {
          this.mode = 'apikey';
        }
      }
    }
    if (!response.ok) {
      await response.body?.cancel();
      const kind = kindOfStatus(response.status);
      if (kind === 'unauthorized' && this.mode === 'apikey') {
        // The key stopped working (changed on the printer): digest next time.
        this.mode = 'digest';
        this.challenge = null;
      }
      throw new PrusaLinkError(
        kind,
        `PrusaLink answered HTTP ${response.status} to ${method} ${path}`,
        response.status,
      );
    }
    return response;
  }

  /** GET a JSON document; null for 204 (no job, no image). */
  async getJson(path) {
    const response = await this.#send('GET', path, 'application/json');
    if (response.status === 204) {
      return null;
    }
    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new PrusaLinkError('unreachable', `PrusaLink unreachable (${err.message})`);
    }
    if (text.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PrusaLinkError('invalid', `PrusaLink sent invalid JSON for ${path}`);
    }
  }

  /** A command without body (PUT pause/resume, DELETE job). */
  async command(method, path) {
    const response = await this.#send(method, path, 'application/json');
    await response.body?.cancel();
  }

  /**
   * GET an image. Resolves `{ mime, data }` (a Buffer), or null when the
   * printer has none (204). Throws `too_large` beyond `maxBytes`.
   */
  async getImage(path, maxBytes) {
    const response = await this.#send('GET', path, 'image/*');
    if (response.status === 204) {
      return null;
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw Object.assign(new PrusaLinkError('invalid', 'Image too large'), { code: 'too_large' });
    }
    let data;
    try {
      data = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      throw new PrusaLinkError('unreachable', `PrusaLink unreachable (${err.message})`);
    }
    if (data.length > maxBytes) {
      throw Object.assign(new PrusaLinkError('invalid', 'Image too large'), { code: 'too_large' });
    }
    const mime = imageType(data);
    if (!mime) {
      throw Object.assign(new PrusaLinkError('invalid', 'Not a PNG or JPEG image'), {
        code: 'image_format',
      });
    }
    return { mime, data };
  }
}

/** PNG or JPEG, by magic numbers (the core validates widget images the same way). */
export function imageType(data) {
  if (
    data.length > 8 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}
