// The digest of PrusaLink: header format (the firmware's quirks) and the
// fallback to an API key, against the simulator and by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PrusaLinkClient,
  digestHeader,
  imageType,
  parseDigestChallenge,
} from '../src/prusalink/client.js';
import { FakePrusaLink, PASSWORD, PNG } from './helpers/fakePrusaLink.js';

const md5 = (text) => createHash('md5').update(text).digest('hex');

test('the challenge of the firmware is read', () => {
  assert.deepEqual(
    parseDigestChallenge('Digest realm="Printer API", nonce="0123456789abcdef", stale=true'),
    {
      realm: 'Printer API',
      nonce: '0123456789abcdef',
      opaque: undefined,
      algorithm: undefined,
      qop: null,
      stale: true,
    },
  );
  assert.equal(parseDigestChallenge('ApiKey realm="Printer API"'), null);
  assert.equal(parseDigestChallenge(null), null);
  assert.equal(
    parseDigestChallenge('Digest realm="x", qop="auth,auth-int", nonce="n"').qop,
    'auth',
  );
});

test('without qop, the header names no algorithm (firmwares before 5.2 refuse it)', () => {
  const challenge = { realm: 'Printer API', nonce: 'abc', qop: null, algorithm: 'MD5' };
  const header = digestHeader({
    challenge,
    username: 'maker',
    password: 'secret',
    method: 'GET',
    uri: '/api/v1/status',
  });
  const ha1 = md5('maker:Printer API:secret');
  const ha2 = md5('GET:/api/v1/status');
  assert.ok(header.includes(`response="${md5(`${ha1}:abc:${ha2}`)}"`));
  assert.doesNotMatch(header, /algorithm/);
  assert.doesNotMatch(header, /qop/);
});

test('with qop, nc and cnonce are sent', () => {
  const header = digestHeader({
    challenge: { realm: 'r', nonce: 'n', qop: 'auth', algorithm: 'MD5' },
    username: 'maker',
    password: 'p',
    method: 'PUT',
    uri: '/api/v1/job/3/pause',
    nc: 2,
    cnonce: 'c',
  });
  assert.match(header, /qop=auth, nc=00000002, cnonce="c"/);
  assert.match(header, /algorithm=MD5/);
});

test('one challenge, then every request reuses the nonce', async (t) => {
  const fake = new FakePrusaLink();
  const url = await fake.start();
  t.after(() => fake.stop());
  const client = new PrusaLinkClient({ baseUrl: url, password: PASSWORD });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await client.getJson('/api/v1/status')).printer.state, 'IDLE');
  }
  assert.deepEqual(
    fake.requests.map((r) => r.auth),
    [null, 'digest', 'digest', 'digest'],
  );
  assert.equal(await client.getJson('/api/v1/job'), null, '204 without job');
});

test('a wrong password ends as unauthorized after one API key attempt', async (t) => {
  const fake = new FakePrusaLink();
  const url = await fake.start();
  t.after(() => fake.stop());
  const client = new PrusaLinkClient({ baseUrl: url, password: 'wrong' });
  await assert.rejects(client.getJson('/api/v1/status'), { kind: 'unauthorized' });
  assert.equal(fake.requests.length, 3);
});

test('errors are sorted, and never carry the password', async (t) => {
  const fake = new FakePrusaLink();
  const url = await fake.start();
  t.after(() => fake.stop());
  const client = new PrusaLinkClient({ baseUrl: url, password: PASSWORD });
  await assert.rejects(client.command('PUT', '/api/v1/job/1/pause'), { kind: 'not_found' });
  fake.setIdle();
  fake.job = { id: 1 };
  await assert.rejects(client.command('PUT', '/api/v1/job/1/pause'), { kind: 'conflict' });
  await fake.stop();
  const err = await client.getJson('/api/v1/status').catch((e) => e);
  assert.equal(err.kind, 'unreachable');
  assert.doesNotMatch(err.message, new RegExp(PASSWORD));
});

test('images: PNG or JPEG only, within the size', async (t) => {
  assert.equal(imageType(PNG), 'image/png');
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageType(Buffer.from('<html>')), null);
  const fake = new FakePrusaLink();
  const url = await fake.start();
  t.after(() => fake.stop());
  const client = new PrusaLinkClient({ baseUrl: url, password: PASSWORD });
  assert.equal(await client.getImage('/api/v1/cameras/snap', 1000), null);
  fake.camera = PNG;
  assert.equal((await client.getImage('/api/v1/cameras/snap', 1000)).mime, 'image/png');
  await assert.rejects(client.getImage('/api/v1/cameras/snap', 10), { code: 'too_large' });
  fake.camera = Buffer.from('not an image at all');
  await assert.rejects(client.getImage('/api/v1/cameras/snap', 1000), { code: 'image_format' });
});
