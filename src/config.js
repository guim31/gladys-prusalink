// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three printers, one "slot" each (`url_1`, `username_1`, `password_1`...).
// The slot number is the identity of the Gladys device: changing the address
// of a printer (new IP) keeps its device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// The user of PrusaLink on every printer with the firmware built in (MK4,
// Core One, XL, MINI): fixed by the firmware. PrusaLink on a Raspberry Pi
// (MK3S) lets the user pick one in its setup wizard.
export const DEFAULT_USERNAME = 'maker';

export const DEFAULT_CONFIG = {
  url_1: '',
  username_1: '',
  password_1: '',
  url_2: '',
  username_2: '',
  password_2: '',
  url_3: '',
  username_3: '',
  password_3: '',
  language: 'fr',
};

export const urlKey = (slot) => `url_${slot}`;
export const usernameKey = (slot) => `username_${slot}`;
export const passwordKey = (slot) => `password_${slot}`;

/**
 * Turn what the user typed into the base URL of the printer: `192.0.2.10`,
 * `192.0.2.10:8080`, `prusa-mk4.local` or a full URL. Returns null when it is
 * not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const printers = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(source[urlKey(slot)]);
    if (typed === '') {
      continue;
    }
    const url = normalizeUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    printers.push({
      slot,
      url,
      username: text(source[usernameKey(slot)]) || DEFAULT_USERNAME,
      // Not trimmed: a password may end with a space.
      password: typeof source[passwordKey(slot)] === 'string' ? source[passwordKey(slot)] : '',
    });
  }
  return {
    printers,
    invalidSlots: invalid,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
