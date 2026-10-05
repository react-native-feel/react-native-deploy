// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it } from 'vitest';

import { deviceClassFor, enrollmentProfile, normalizeUdid, parseDeviceAttributes } from './devices.js';
import worker from './index.js';
import { installPage } from './install.js';

// Through require: Vite's resolver predates node:sqlite and strips the prefix.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

// A Workers-only extension the bearer check uses; Node has the same primitive.
if (!crypto.subtle.timingSafeEqual) {
  const { timingSafeEqual } = require('node:crypto');
  crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * D1's statement API over node:sqlite, with the real migration applied, so the
 * Worker's SQL runs against SQLite exactly as it will in D1.
 */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_devices.sql', import.meta.url), 'utf-8'));
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => db.prepare(sql).run(...params),
  });
  return { prepare: (sql) => statement(sql) };
}

const ORIGIN = 'https://deploy.test';
const TOKEN = 'secret-upload-token';
const UDID = '00008140-000024A414C1801C';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

let env;
beforeEach(() => {
  env = { DB: fakeD1(), UPLOAD_TOKEN: TOKEN };
});

function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    }),
    env
  );
}

/** What iOS posts back: the reply plist wrapped in (here, fake) CMS bytes. */
function deviceReply({ udid = UDID, challenge, product = 'iPhone17,3', name = 'Ana’s iPhone' }) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CHALLENGE</key><string>${challenge}</string>
<key>DEVICE_NAME</key><string>${name}</string>
<key>PRODUCT</key><string>${product}</string>
<key>UDID</key><string>${udid}</string>
<key>VERSION</key><string>22A3354</string>
</dict></plist>`;
  const der = [0x30, 0x82, 0x0b, 0x2c, 0x06, 0x09];
  return new Uint8Array([...der, ...new TextEncoder().encode(plist), 0xa0, 0x82, 0x00]);
}

describe('device helpers', () => {
  it('normalizes both UDID formats and rejects anything else', () => {
    expect(normalizeUdid(' 00008140-000024a414c1801c ')).toBe(UDID);
    expect(normalizeUdid('A'.repeat(40))).toBe('a'.repeat(40));
    expect(normalizeUdid('not-a-udid')).toBeNull();
    expect(normalizeUdid('00008140-000024A414C1801')).toBeNull();
  });

  it('files a product identifier under App Store Connect device classes', () => {
    expect(deviceClassFor('iPhone17,3')).toBe('IPHONE');
    expect(deviceClassFor('iPad14,1')).toBe('IPAD');
    expect(deviceClassFor('Mac14,2')).toBe('MAC');
  });

  it('writes a Profile Service payload that asks for the UDID and posts back to us', () => {
    const profile = enrollmentProfile({ callbackUrl: `${ORIGIN}/register-device/t/callback`, token: 'abc' });
    expect(profile).toContain('<string>Profile Service</string>');
    expect(profile).toContain(`<string>${ORIGIN}/register-device/t/callback</string>`);
    expect(profile).toContain('<string>UDID</string>');
    expect(profile).toContain('<key>Challenge</key><string>abc</string>');
  });

  it('reads the attributes out of the signed reply without a crypto library', () => {
    const attrs = parseDeviceAttributes(deviceReply({ challenge: 'abc', name: 'Tom &amp; Ana' }));
    expect(attrs).toMatchObject({ UDID, PRODUCT: 'iPhone17,3', CHALLENGE: 'abc', DEVICE_NAME: 'Tom & Ana' });
    expect(parseDeviceAttributes(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('device API', () => {
  it('requires the bearer token', async () => {
    expect((await call('/api/devices', { auth: false })).status).toBe(401);
  });

  it('answers 503 when no D1 database is bound', async () => {
    env.DB = undefined;
    expect((await call('/api/devices')).status).toBe(503);
  });

  it('adds, lists, renames and removes a device', async () => {
    const created = await call('/api/devices', {
      method: 'POST',
      body: { udid: UDID.toLowerCase(), name: 'QA iPhone', product: 'iPhone17,3', source: 'manual' },
    });
    expect(created.status).toBe(201);
    expect((await created.json()).device).toMatchObject({ udid: UDID, status: 'pending', deviceClass: 'IPHONE' });

    await call(`/api/devices/${UDID}`, { method: 'PATCH', body: { name: 'QA iPhone 16' } });
    const { devices } = await (await call('/api/devices')).json();
    expect(devices.map((d) => d.name)).toEqual(['QA iPhone 16']);

    const removed = await (await call(`/api/devices/${UDID}`, { method: 'DELETE' })).json();
    expect(removed.device.status).toBe('disabled');
    expect((await (await call('/api/devices?status=pending')).json()).devices).toEqual([]);
  });

  it('records the Apple side when the workflow registers a device', async () => {
    await call('/api/devices', { method: 'POST', body: { udid: UDID, name: 'A', source: 'manual' } });
    const res = await call(`/api/devices/${UDID}`, {
      method: 'PATCH',
      body: { status: 'registered', appleDeviceId: '3KXB754D94', appleTeamId: 'ABCDE12345' },
    });
    const { device } = await res.json();
    expect(device).toMatchObject({ status: 'registered', appleDeviceId: '3KXB754D94' });
    expect(device.registeredAt).not.toBeNull();
  });

  it('re-adding a removed device brings it back, but never demotes a registered one', async () => {
    const add = () => call('/api/devices', { method: 'POST', body: { udid: UDID, name: 'A', source: 'manual' } });
    await add();
    await call(`/api/devices/${UDID}`, { method: 'PATCH', body: { status: 'registered', appleDeviceId: 'X1' } });
    expect((await (await add()).json()).device).toMatchObject({ status: 'registered', appleDeviceId: 'X1' });

    await call(`/api/devices/${UDID}`, { method: 'DELETE' });
    expect((await (await add()).json()).device.status).toBe('pending');
  });

  it('imports devices Apple already has as registered', async () => {
    const res = await call('/api/devices', {
      method: 'POST',
      body: { udid: UDID, name: 'Old', source: 'import', appleDeviceId: '3KXB754D94' },
    });
    expect((await res.json()).device.status).toBe('registered');
  });

  it('rejects bad input with a 400', async () => {
    const bad = await call('/api/devices', { method: 'POST', body: { udid: 'nope', name: 'A', source: 'manual' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/udid/);
    await call('/api/devices', { method: 'POST', body: { udid: UDID, name: 'A', source: 'manual' } });
    expect((await call(`/api/devices/${UDID}`, { method: 'PATCH', body: { status: 'gone' } })).status).toBe(400);
    expect((await call('/api/devices/0000', { method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
  });
});

describe('registration through a QR link', () => {
  async function newLink() {
    const res = await call('/api/devices/requests', { method: 'POST' });
    expect(res.status).toBe(201);
    return res.json();
  }

  it('creates a link under this origin', async () => {
    const link = await newLink();
    expect(link.url).toBe(`${ORIGIN}/register-device/${link.token}`);
    expect(link.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('runs the whole Profile Service round trip', async () => {
    const { token } = await newLink();

    const landing = await call(`/register-device/${token}`, { auth: false, headers: { 'user-agent': IPHONE_UA } });
    expect(await landing.text()).toContain(`/register-device/${token}/profile.mobileconfig`);

    const profile = await call(`/register-device/${token}/profile.mobileconfig`, { auth: false });
    expect(profile.headers.get('content-type')).toBe('application/x-apple-aspen-config');
    expect(await profile.text()).toContain(`${ORIGIN}/register-device/${token}/callback`);

    const callback = await call(`/register-device/${token}/callback`, {
      method: 'POST',
      auth: false,
      body: deviceReply({ challenge: token }),
    });
    expect(callback.status).toBe(301);
    const done = new URL(callback.headers.get('location'));
    expect(done.pathname).toBe(`/register-device/${token}/done`);

    const confirmation = await call(done.pathname + done.search, { auth: false });
    expect(confirmation.status).toBe(200);
    expect(await confirmation.text()).toContain('Device registered');
    expect(confirmation.headers.get('set-cookie')).toContain(`rnd_udid=${encodeURIComponent(UDID)}`);

    const { devices } = await (await call('/api/devices')).json();
    expect(devices).toEqual([
      expect.objectContaining({ udid: UDID, name: 'Ana’s iPhone', product: 'iPhone17,3', source: 'url', status: 'pending' }),
    ]);
  });

  it('shows a desktop a QR instead of the profile', async () => {
    const { token } = await newLink();
    const page = await (await call(`/register-device/${token}`, { auth: false })).text();
    expect(page).toContain('<div class="qr"');
  });

  it('refuses unknown tokens, a mismatched challenge, and other links’ devices', async () => {
    expect((await call(`/register-device/${'0'.repeat(32)}`, { auth: false })).status).toBe(404);

    const { token } = await newLink();
    const forged = await call(`/register-device/${token}/callback`, {
      method: 'POST',
      auth: false,
      body: deviceReply({ challenge: 'f'.repeat(32) }),
    });
    expect(forged.status).toBe(400);

    await call('/api/devices', { method: 'POST', body: { udid: UDID, name: 'A', source: 'manual' } });
    const peek = await call(`/register-device/${token}/done?udid=${UDID}`, { auth: false });
    expect(peek.status).toBe(404);
  });

  it('expires links', async () => {
    const { token } = await newLink();
    await env.DB.prepare('UPDATE registration_requests SET expires_at = 0 WHERE token = ?').bind(token).run();
    expect((await call(`/register-device/${token}`, { auth: false })).status).toBe(404);
  });
});

describe('install page and provisioned devices', () => {
  const meta = { platform: 'ios', name: 'My App', bundleId: 'com.acme.app', version: '1.0.0' };
  const urls = { pageUrl: 'https://x.dev/install/a', manifestUrl: 'https://x.dev/install/a/manifest.plist', fileUrl: '' };
  const devices = [{ udid: UDID, name: 'Ana’s iPhone', product: 'iPhone17,3' }];

  it('lists the devices a build installs on', () => {
    const page = installPage({ meta, device: 'ios', ...urls, provisionedDevices: devices });
    expect(page).toContain('Installs on 1 device');
    expect(page).toContain('Ana’s iPhone · iPhone17,3');
    expect(page).not.toContain('class="warning"');
  });

  it('warns a registered phone that is not in the build, before it installs', () => {
    const other = '00008101-000A1B2C3D4E5F60';
    expect(installPage({ meta, device: 'ios', ...urls, provisionedDevices: devices, viewerUdid: other })).toContain(
      'class="warning"'
    );
    expect(installPage({ meta, device: 'ios', ...urls, provisionedDevices: devices, viewerUdid: UDID })).toContain(
      '(this device)'
    );
  });

  it('names the provisioned UDIDs from the registry', async () => {
    await call('/api/devices', { method: 'POST', body: { udid: UDID, name: 'QA iPhone', product: 'iPhone17,3', source: 'manual' } });
    const id = '0f8b5c3e-1a2b-4c3d-8e9f-0123456789ab';
    env.BUILDS = {
      get: async (key) =>
        key === `builds/${id}/meta.json` ? { json: async () => ({ ...meta, provisionedDevices: [UDID] }) } : null,
    };
    const page = await (await call(`/install/${id}`, { auth: false, headers: { 'user-agent': IPHONE_UA } })).text();
    expect(page).toContain('QA iPhone · iPhone17,3');
  });
});
