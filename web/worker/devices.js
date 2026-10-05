/**
 * Device registration for ad-hoc iOS builds, backed by D1 (`env.DB`).
 *
 * A tester scans a QR for /register-device/<token>, installs a one-shot
 * configuration profile, and iOS posts the phone's UDID back to us — Apple's
 * over-the-air "Profile Service" enrollment, the same mechanism behind EAS's
 * expo.dev/register-device links. The phone ends up with nothing installed.
 *
 * The device is stored as `pending`. Registering it with Apple and regenerating
 * the ad-hoc profile happens in the build workflow, which holds the App Store
 * Connect key: a public URL here never touches the Apple account directly.
 */

import { qrSvg } from './install.js';

export const REGISTRATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN = /^[0-9a-f]{32}$/;
const STATUSES = new Set(['pending', 'registered', 'disabled']);
const SOURCES = new Set(['url', 'usb', 'mac', 'manual', 'import']);
const CLASSES = new Set(['IPHONE', 'IPAD', 'IPOD', 'MAC', 'APPLE_WATCH', 'APPLE_TV', 'APPLE_VISION_PRO']);

/** A new registration token: 128 random bits, hex. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isToken(value) {
  return TOKEN.test(value ?? '');
}

/**
 * Normalizes a UDID, or returns null when it is not one. Devices since the
 * iPhone XS (and Apple silicon Macs) use `00008140-000024A414C1801C`; older ones
 * a 40-character hex string. Apple shows the first in upper case, the second in
 * lower case, so we store them the same way.
 */
export function normalizeUdid(value) {
  const udid = String(value ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{16}$/i.test(udid)) return udid.toUpperCase();
  if (/^[0-9a-f]{40}$/i.test(udid)) return udid.toLowerCase();
  return null;
}

/** "iPhone17,3" → IPHONE: the class App Store Connect files a device under. */
export function deviceClassFor(product) {
  const p = String(product ?? '');
  if (p.startsWith('iPhone')) return 'IPHONE';
  if (p.startsWith('iPad')) return 'IPAD';
  if (p.startsWith('iPod')) return 'IPOD';
  if (p.startsWith('Watch')) return 'APPLE_WATCH';
  if (p.startsWith('AppleTV')) return 'APPLE_TV';
  if (p.startsWith('RealityDevice')) return 'APPLE_VISION_PRO';
  if (/^(Mac|iMac)/.test(p)) return 'MAC';
  return 'IPHONE';
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(value) {
  return xml(value);
}

/**
 * The enrollment profile. iOS shows it under Settings → "Profile Downloaded",
 * and on install posts the requested DeviceAttributes to `URL`, signed by the
 * device. It is unsigned itself, so iOS labels it "Not Verified"; that is
 * cosmetic and does not stop the install.
 */
export function enrollmentProfile({ callbackUrl, token, organization = 'React Native Deploy' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key><string>${xml(callbackUrl)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>PRODUCT</string>
      <string>VERSION</string>
      <string>DEVICE_NAME</string>
    </array>
    <key>Challenge</key><string>${xml(token)}</string>
  </dict>
  <key>PayloadOrganization</key><string>${xml(organization)}</string>
  <key>PayloadDisplayName</key><string>Register this device</string>
  <key>PayloadDescription</key><string>Shares this device's identifier (UDID) and model so internal builds can be signed for it. Nothing stays installed.</string>
  <key>PayloadIdentifier</key><string>dev.react-native-deploy.register-device.${xml(token)}</string>
  <key>PayloadUUID</key><string>${crypto.randomUUID().toUpperCase()}</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadType</key><string>Profile Service</string>
</dict>
</plist>
`;
}

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Reads the device's reply. iOS posts a CMS (PKCS#7) envelope whose content is
 * a plain XML plist, so the plist can be sliced out of the bytes without a
 * crypto library. The envelope signature is not verified: the token already
 * gates who can post, and Apple itself validates every UDID at registration.
 */
export function parseDeviceAttributes(bytes) {
  // Find the plist with a one-byte-per-char decoding, so string offsets are byte
  // offsets, then decode just that slice as UTF-8: device names are often
  // "Ana’s iPhone", with a curly apostrophe.
  const text = new TextDecoder('latin1').decode(bytes);
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>', start);
  if (start === -1 || end === -1) {
    return null;
  }
  const plist = new TextDecoder('utf-8').decode(bytes.subarray(start, end));
  const attrs = {};
  for (const [, key, value] of plist.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    attrs[key] = unescapeXml(value);
  }
  return attrs;
}

/* ---------------------------------------------------------------- data access */

function now() {
  return Date.now();
}

/** A row as the API returns it: camelCase, the shape the CLI and workflow read. */
export function toDevice(row) {
  if (!row) return null;
  return {
    udid: row.udid,
    name: row.name,
    product: row.product,
    osVersion: row.os_version,
    deviceClass: row.device_class,
    status: row.status,
    source: row.source,
    appleDeviceId: row.apple_device_id,
    appleTeamId: row.apple_team_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    registeredAt: row.registered_at ? new Date(row.registered_at).toISOString() : null,
  };
}

export async function createRegistrationRequest(db, { ttlMs = REGISTRATION_TTL_MS } = {}) {
  const token = newToken();
  const created = now();
  const expires = created + ttlMs;
  await db
    .prepare('INSERT INTO registration_requests (token, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(token, created, expires)
    .run();
  return { token, expiresAt: new Date(expires).toISOString() };
}

/** The request behind a token, or null when it is unknown or expired. */
export async function liveRegistrationRequest(db, token) {
  if (!isToken(token)) return null;
  const row = await db
    .prepare('SELECT token, expires_at FROM registration_requests WHERE token = ?')
    .bind(token)
    .first();
  if (!row || row.expires_at < now()) return null;
  return row;
}

export async function listDevices(db, { status } = {}) {
  const query = status
    ? db.prepare('SELECT * FROM devices WHERE status = ? ORDER BY created_at').bind(status)
    : db.prepare('SELECT * FROM devices ORDER BY created_at');
  const { results } = await query.all();
  return results.map(toDevice);
}

export async function getDevice(db, udid) {
  const normalized = normalizeUdid(udid);
  if (!normalized) return null;
  return toDevice(await db.prepare('SELECT * FROM devices WHERE udid = ?').bind(normalized).first());
}

/**
 * Adds a device, or refreshes one we already have. Registering a device again
 * re-enables it if it was removed, but never demotes one Apple already knows:
 * a `registered` row keeps its Apple id and status.
 */
export async function upsertDevice(db, input) {
  const udid = normalizeUdid(input.udid);
  if (!udid) {
    throw new DeviceInputError('udid must be a device UDID (00008140-000024A414C1801C or 40 hex characters)');
  }
  if (!SOURCES.has(input.source)) {
    throw new DeviceInputError(`source must be one of ${[...SOURCES].join(', ')}`);
  }
  const deviceClass = input.deviceClass ?? deviceClassFor(input.product);
  if (!CLASSES.has(deviceClass)) {
    throw new DeviceInputError(`deviceClass must be one of ${[...CLASSES].join(', ')}`);
  }
  const name = String(input.name ?? '').trim() || input.product || 'iOS device';
  const stamp = now();
  await db
    .prepare(
      `INSERT INTO devices (udid, name, product, os_version, device_class, status, source,
                            apple_device_id, apple_team_id, registration_token, created_at, updated_at, registered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)
       ON CONFLICT (udid) DO UPDATE SET
         name = excluded.name,
         product = COALESCE(excluded.product, devices.product),
         os_version = COALESCE(excluded.os_version, devices.os_version),
         device_class = excluded.device_class,
         status = CASE WHEN devices.status = 'disabled' OR excluded.status = 'registered'
                       THEN excluded.status ELSE devices.status END,
         apple_device_id = COALESCE(excluded.apple_device_id, devices.apple_device_id),
         apple_team_id = COALESCE(devices.apple_team_id, excluded.apple_team_id),
         registration_token = COALESCE(excluded.registration_token, devices.registration_token),
         updated_at = excluded.updated_at,
         registered_at = COALESCE(devices.registered_at, excluded.registered_at)`
    )
    .bind(
      udid,
      name.slice(0, 100),
      input.product ?? null,
      input.osVersion ?? null,
      deviceClass,
      // An import comes from Apple's own list, so it is registered already.
      input.appleDeviceId ? 'registered' : 'pending',
      input.source,
      input.appleDeviceId ?? null,
      input.appleTeamId ?? null,
      input.registrationToken ?? null,
      stamp,
      input.appleDeviceId ? stamp : null
    )
    .run();
  return getDevice(db, udid);
}

/** Renames, removes (status: disabled), or records the Apple side of a device. */
export async function updateDevice(db, udid, patch) {
  const normalized = normalizeUdid(udid);
  const current = normalized && (await db.prepare('SELECT * FROM devices WHERE udid = ?').bind(normalized).first());
  if (!current) return null;
  if (patch.status !== undefined && !STATUSES.has(patch.status)) {
    throw new DeviceInputError(`status must be one of ${[...STATUSES].join(', ')}`);
  }
  if (patch.name !== undefined && !String(patch.name).trim()) {
    throw new DeviceInputError('name cannot be empty');
  }
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim().slice(0, 100) : current.name,
    status: patch.status ?? current.status,
    apple_device_id: patch.appleDeviceId ?? current.apple_device_id,
    apple_team_id: patch.appleTeamId ?? current.apple_team_id,
  };
  const becameRegistered = next.status === 'registered' && current.status !== 'registered';
  await db
    .prepare(
      `UPDATE devices SET name = ?, status = ?, apple_device_id = ?, apple_team_id = ?,
              updated_at = ?, registered_at = COALESCE(?, registered_at)
       WHERE udid = ?`
    )
    .bind(
      next.name,
      next.status,
      next.apple_device_id,
      next.apple_team_id,
      now(),
      becameRegistered ? now() : null,
      normalized
    )
    .run();
  return getDevice(db, normalized);
}

/** Names and models for the UDIDs a build was signed for, in profile order. */
export async function describeUdids(db, udids) {
  const wanted = udids.map(normalizeUdid).filter(Boolean);
  if (wanted.length === 0) return [];
  const placeholders = wanted.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM devices WHERE udid IN (${placeholders})`)
    .bind(...wanted)
    .all();
  const byUdid = new Map(results.map((row) => [row.udid, row]));
  return wanted.map((udid) => {
    const row = byUdid.get(udid);
    return { udid, name: row?.name ?? null, product: row?.product ?? null };
  });
}

export class DeviceInputError extends Error {}

/* ---------------------------------------------------------------------- pages */

const STYLE = `
  :root { --bg:#f5f5f4; --card:#fff; --text:#18181b; --muted:#71717a; --line:#e4e4e7; --accent:#4f46e5; --accent-text:#fff; --ok:#15803d; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0b0d; --card:#17171a; --text:#f4f4f5; --muted:#a1a1aa; --line:#27272a; --accent:#818cf8; --accent-text:#0b0b0d; --ok:#4ade80; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text);
         font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         display:flex; align-items:flex-start; justify-content:center; padding:32px 16px; }
  main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:24px; }
  h1 { margin:0 0 8px; font-size:20px; line-height:1.25; }
  p { margin:0 0 12px; }
  .muted, .steps, .note { color:var(--muted); font-size:14px; }
  .button { display:block; text-align:center; background:var(--accent); color:var(--accent-text);
            text-decoration:none; font-weight:600; padding:14px; border-radius:12px; font-size:17px; margin:16px 0 0; }
  .steps { margin:16px 0 0; padding-left:20px; } .steps li + li { margin-top:4px; }
  .qr { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; width:232px; margin:16px auto 0; }
  .qr svg { display:block; width:100%; height:auto; }
  .link { font:13px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg); border:1px solid var(--line);
          border-radius:8px; padding:10px; overflow-wrap:anywhere; margin:8px 0 0; }
  .ok { color:var(--ok); font-weight:600; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:16px 0 0; font-size:14px; }
  dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${html(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/** Where the registration QR lands: the profile on an iPhone, a QR anywhere else. */
export function registrationPage({ pageUrl, profileUrl, device }) {
  if (device === 'ios') {
    return page(
      'Register this device',
      `<h1>Register this device</h1>
  <p class="muted">So internal builds of this app can be installed on it.</p>
  <a class="button" href="${html(profileUrl)}">Download profile</a>
  <ol class="steps">
    <li>Tap <strong>Download profile</strong>, then <strong>Allow</strong>.</li>
    <li>Open <strong>Settings</strong> and tap <strong>Profile Downloaded</strong> near the top.</li>
    <li>Tap <strong>Install</strong> and enter your passcode. You come back here when it's done.</li>
  </ol>
  <p class="note">The profile only shares this device's identifier (UDID) and model. Nothing stays installed. Builds made from now on will include this device.</p>`
    );
  }
  return page(
    'Register a device',
    `<h1>Register an iPhone or iPad</h1>
  <p class="muted">Scan with the Camera app on the device you want to register.</p>
  <div class="qr" role="img" aria-label="QR code for this registration page">${qrSvg(pageUrl)}</div>
  <p class="note">Or open this link in Safari on the device:</p>
  <p class="link">${html(pageUrl)}</p>`
  );
}

export function registeredPage({ device }) {
  return page(
    'Device registered',
    `<h1><span class="ok">✓</span> Device registered</h1>
  <p class="muted">The next internal build will include this device. Builds made before now cannot be installed on it.</p>
  <dl>
    <dt>Name</dt><dd>${html(device.name)}</dd>
    ${device.product ? `<dt>Model</dt><dd>${html(device.product)}</dd>` : ''}
    <dt>UDID</dt><dd>${html(device.udid)}</dd>
  </dl>`
  );
}

export function registrationErrorPage(message) {
  return page('Registration link not valid', `<h1>Registration link not valid</h1><p class="muted">${html(message)}</p>`);
}
