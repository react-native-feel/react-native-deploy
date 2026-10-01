/**
 * Pure pieces of the install service: object keys, the iOS OTA manifest, and the
 * install page. Kept free of Worker globals so they can be unit-tested.
 *
 * An installable build lives in R2 under `builds/<dispatchId>/`:
 *   meta.json   what the install page shows, written last by the workflow
 *   app.ipa     or app.apk
 *
 * The dispatch id is the random UUID the CLI stamps into the run name. It is the
 * only thing in the install URL, so a link cannot be guessed from a run number.
 */

import QRCodeCore from 'qrcode/lib/core/qrcode.js';
import SvgRenderer from 'qrcode/lib/renderer/svg-tag.js';

const DISPATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILES = new Set(['meta.json', 'app.ipa', 'app.apk']);

export const CONTENT_TYPES = {
  'meta.json': 'application/json',
  'app.ipa': 'application/octet-stream',
  'app.apk': 'application/vnd.android.package-archive',
};

export function isDispatchId(value) {
  return DISPATCH_ID.test(value ?? '');
}

/**
 * Validates an upload key. Only `builds/<uuid>/<known file>` is writable, so a
 * leaked upload token cannot be used to overwrite arbitrary bucket contents.
 */
export function parseUploadKey(key) {
  const match = /^builds\/([^/]+)\/([^/]+)$/.exec(key ?? '');
  if (!match || !isDispatchId(match[1]) || !FILES.has(match[2])) {
    return null;
  }
  return { dispatchId: match[1].toLowerCase(), file: match[2] };
}

export function buildPrefix(dispatchId) {
  return `builds/${dispatchId.toLowerCase()}/`;
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The manifest iOS fetches after an `itms-services://` link. Both it and the IPA
 * must be served over HTTPS with a valid certificate, or iOS fails silently.
 */
export function iosManifest({ ipaUrl, bundleId, version, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${xml(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${xml(bundleId)}</string>
        <key>bundle-version</key><string>${xml(version)}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xml(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function itmsServicesUrl(manifestUrl) {
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (!bytes) return null;
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

/**
 * A QR code for the page itself, as inline SVG. Synchronous and DOM-free, so the
 * page needs no script and the function stays testable.
 */
export function qrSvg(text) {
  const qr = QRCodeCore.create(text, { errorCorrectionLevel: 'M' });
  return SvgRenderer.render(qr, { margin: 1, color: { dark: '#000000ff', light: '#ffffffff' } });
}

/** Which device is asking, from the user agent. iPadOS 13+ claims to be a Mac. */
export function devicePlatform(userAgent = '') {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent)) return 'ios';
  return 'other';
}

/**
 * The page a QR code lands on. One action per platform, and the reason when the
 * build cannot be installed on the device holding the phone.
 */
export function installPage({ meta, pageUrl, manifestUrl, fileUrl, device }) {
  const isIos = meta.platform === 'ios';
  const platformLabel = isIos ? 'iOS' : 'Android';
  const initial = html((meta.name ?? '?').trim().charAt(0).toUpperCase() || '?');
  const facts = [
    ['Version', meta.buildNumber ? `${meta.version} (${meta.buildNumber})` : meta.version],
    ['Profile', meta.profile],
    ['Platform', platformLabel],
    ['Size', formatSize(meta.size)],
    ['Commit', meta.commit ? meta.commit.slice(0, 7) : null],
    ['Built', meta.createdAt ? new Date(meta.createdAt).toUTCString().replace(' GMT', ' UTC') : null],
  ].filter(([, value]) => value);

  let action;
  if (isIos && device === 'ios') {
    action = `
      <a class="button" href="${html(itmsServicesUrl(manifestUrl))}">Install</a>
      <ol class="steps">
        <li>Tap <strong>Install</strong>, then <strong>Install</strong> again in the prompt.</li>
        <li>The app appears on your home screen — watch its icon finish downloading.</li>
        <li>On iOS 16 or later, turn on <strong>Settings → Privacy &amp; Security → Developer Mode</strong> the first time.</li>
      </ol>
      <p class="note">Only devices in this build's provisioning profile can install it. A device registered after the build needs a new build.</p>`;
  } else if (!isIos && device === 'android') {
    action = `
      <a class="button" href="${html(fileUrl)}" download>Download APK</a>
      <ol class="steps">
        <li>Tap <strong>Download APK</strong>.</li>
        <li>Open the downloaded file, and allow installs from your browser if asked.</li>
      </ol>`;
  } else if (device === 'other') {
    action = `
      <p class="scan-title">Scan with ${isIos ? 'your iPhone or iPad' : 'your Android device'}</p>
      <div class="qr" role="img" aria-label="QR code for this install page">${qrSvg(pageUrl)}</div>
      <p class="note">Open the Camera app, point it at the code and tap the banner. Or send yourself this link:</p>
      <p class="link">${html(pageUrl)}</p>
      ${isIos ? '' : `<a class="button button--secondary" href="${html(fileUrl)}" download>Download APK</a>`}`;
  } else {
    action = `<p class="note">This is an ${platformLabel} build — it cannot be installed on this device.</p>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Install ${html(meta.name)}</title>
<style>
  :root { --bg:#f5f5f4; --card:#fff; --text:#18181b; --muted:#71717a; --line:#e4e4e7; --accent:#4f46e5; --accent-text:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0b0d; --card:#17171a; --text:#f4f4f5; --muted:#a1a1aa; --line:#27272a; --accent:#818cf8; --accent-text:#0b0b0d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text);
         font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         display:flex; align-items:flex-start; justify-content:center; padding:32px 16px; }
  main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line);
         border-radius:16px; padding:24px; }
  header { display:flex; gap:14px; align-items:center; margin-bottom:20px; }
  .icon { width:56px; height:56px; border-radius:13px; flex:none; display:grid; place-items:center;
          background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; font-size:24px; font-weight:700; }
  h1 { margin:0; font-size:20px; line-height:1.25; }
  .sub { margin:2px 0 0; color:var(--muted); font-size:14px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:0 0 20px; font-size:14px; }
  dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
  .button { display:block; text-align:center; background:var(--accent); color:var(--accent-text);
            text-decoration:none; font-weight:600; padding:14px; border-radius:12px; font-size:17px; }
  .button--secondary { background:transparent; color:var(--accent); border:1px solid var(--line); margin-top:12px; }
  .steps { margin:16px 0 0; padding-left:20px; font-size:14px; color:var(--muted); }
  .steps li + li { margin-top:4px; }
  .note { font-size:14px; color:var(--muted); margin:16px 0 0; }
  .scan-title { font-weight:600; margin:0 0 12px; }
  .qr { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; width:232px; margin:0 auto; }
  .qr svg { display:block; width:100%; height:auto; }
  .link { font:13px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg);
          border:1px solid var(--line); border-radius:8px; padding:10px; overflow-wrap:anywhere; margin:8px 0 0; }
</style>
</head>
<body>
<main>
  <header>
    <div class="icon" aria-hidden="true">${initial}</div>
    <div>
      <h1>${html(meta.name)}</h1>
      <p class="sub">${html(meta.bundleId ?? '')}</p>
    </div>
  </header>
  <dl>${facts.map(([k, v]) => `<dt>${html(k)}</dt><dd>${html(v)}</dd>`).join('')}</dl>
  ${action}
</main>
</body>
</html>
`;
}

export function notFoundPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Build not available</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#f5f5f4;color:#18181b;
font:16px/1.5 -apple-system,system-ui,sans-serif;text-align:center}
@media (prefers-color-scheme: dark){body{background:#0b0b0d;color:#f4f4f5}}</style></head>
<body><main><h1 style="font-size:20px">Build not available</h1><p style="opacity:.7;max-width:360px">${html(message)}</p></main></body></html>
`;
}
