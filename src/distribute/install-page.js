// Per-build landing page hosted alongside the IPA. Renders an "Install on
// iPhone" link that wraps the itms-services:// URL — Safari on iOS turns this
// into a system install prompt. On any other browser it falls back to a
// "scan this with your iPhone" message.
export function generateInstallPage({
  appTitle,
  bundleId,
  version,
  buildNumber,
  commit,
  profile,
  distribution,
  itmsServicesUrl,
  ipaUrl,
  createdAt,
}) {
  const subtitle = [version, buildNumber && `(${buildNumber})`].filter(Boolean).join(' ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Install ${escapeHtml(appTitle)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
      background: #0b0d10;
      color: #e7eaf0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #15181d;
      border: 1px solid #23272f;
      border-radius: 16px;
      padding: 28px 24px;
      text-align: center;
    }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: #8b94a7; font-size: 14px; margin-bottom: 24px; }
    .install-btn {
      display: inline-block;
      width: 100%;
      padding: 14px 18px;
      background: #2f80ed;
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      border-radius: 10px;
      margin-bottom: 12px;
    }
    .install-btn:active { background: #1f6fda; }
    .fallback {
      display: none;
      font-size: 13px;
      color: #8b94a7;
      padding: 12px;
      border: 1px dashed #2c333d;
      border-radius: 10px;
      margin-top: 16px;
    }
    .meta {
      margin-top: 24px;
      text-align: left;
      font-size: 12px;
      color: #8b94a7;
      line-height: 1.6;
    }
    .meta strong { color: #c8cfdc; font-weight: 500; }
    .ipa-link {
      display: block;
      margin-top: 18px;
      font-size: 12px;
      color: #6c7587;
      text-decoration: none;
      word-break: break-all;
    }
    .not-ios .install-btn { display: none; }
    .not-ios .fallback { display: block; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <h1>${escapeHtml(appTitle)}</h1>
    <div class="sub">${escapeHtml(subtitle)}${distribution ? ' · ' + escapeHtml(distribution) : ''}</div>

    <a class="install-btn" href="${escapeHtml(itmsServicesUrl)}">Install on iPhone / iPad</a>

    <div class="fallback">
      Open this page on the iOS device you want to install on (scan the QR code from your terminal, or send yourself this URL).
    </div>

    <div class="meta">
      <strong>Bundle</strong> ${escapeHtml(bundleId)}<br />
      ${profile ? `<strong>Profile</strong> ${escapeHtml(profile)}<br />` : ''}
      ${commit ? `<strong>Commit</strong> ${escapeHtml(commit)}<br />` : ''}
      ${createdAt ? `<strong>Built</strong> ${escapeHtml(createdAt)}<br />` : ''}
    </div>

    <a class="ipa-link" href="${escapeHtml(ipaUrl)}">Download .ipa</a>
  </div>

  <script>
    var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!isIos) document.getElementById('card').classList.add('not-ios');
  </script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
