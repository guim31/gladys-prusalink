import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeUrl } from '../src/config.js';

test('addresses: bare IP, port, host name, full URL; credentials refused', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(normalizeUrl(' 192.0.2.10:8080/ '), 'http://192.0.2.10:8080');
  assert.equal(normalizeUrl('prusa-mk4.local'), 'http://prusa-mk4.local');
  assert.equal(normalizeUrl('https://example.org/prusa/'), 'https://example.org/prusa');
  assert.equal(normalizeUrl('http://maker:secret@192.0.2.10'), null);
  assert.equal(normalizeUrl('ftp://192.0.2.10'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(42), null);
});

test('slots: empty ones skipped, invalid ones reported, user maker by default', () => {
  const config = normalizeConfig({
    url_1: '192.0.2.10',
    password_1: ' pw ',
    url_2: 'ftp://x',
    url_3: '192.0.2.12',
    username_3: 'pi',
    language: 'de',
  });
  assert.deepEqual(config.printers, [
    { slot: 1, url: 'http://192.0.2.10', username: 'maker', password: ' pw ' },
    { slot: 3, url: 'http://192.0.2.12', username: 'pi', password: '' },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.deepEqual(normalizeConfig(null).printers, []);
});
