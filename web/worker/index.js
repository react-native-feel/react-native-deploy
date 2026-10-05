import {
  CONTENT_TYPES,
  buildPrefix,
  devicePlatform,
  installPage,
  iosManifest,
  isDispatchId,
  notFoundPage,
  parseUploadKey,
} from './install.js';
import {
  DeviceInputError,
  createRegistrationRequest,
  describeUdids,
  enrollmentProfile,
  getDevice,
  listDevices,
  liveRegistrationRequest,
  normalizeUdid,
  parseDeviceAttributes,
  registeredPage,
  registrationErrorPage,
  registrationPage,
  updateDevice,
  upsertDevice,
} from './devices.js';

/**
 * One Worker for everything a tester's phone or browser touches:
 *
 *   /deploy/dashboard/*            the Vite dashboard (static assets, SPA fallback)
 *   /deploy/docs/*                 the VitePress docs (static assets, its own 404 page)
 *   /install/<dispatchId>          public install page a QR code points at
 *   /install/<dispatchId>/manifest.plist   iOS OTA manifest
 *   /install/<dispatchId>/app.ipa|apk      the binary, streamed from R2
 *   /api/uploads/builds/<id>/<file>        workflow-only, bearer UPLOAD_TOKEN
 *   /register-device/<token>[/…]           public device registration (D1)
 *   /api/devices[/…]                       device registry for the CLI and workflow, bearer UPLOAD_TOKEN
 */
const DASHBOARD = '/deploy/dashboard/';
const DOCS = '/deploy/docs/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/' || pathname === '/deploy' || pathname === '/deploy/' || pathname === '/deploy/dashboard') {
      return Response.redirect(`${url.origin}${DASHBOARD}`, 302);
    }
    if (pathname.startsWith('/api/uploads/')) {
      return handleUpload(request, env, url);
    }
    if (pathname.startsWith('/install/')) {
      return handleInstall(request, env, url);
    }
    if (pathname === '/api/devices' || pathname.startsWith('/api/devices/')) {
      return handleDevicesApi(request, env, url);
    }
    if (pathname.startsWith('/register-device/')) {
      return handleRegistration(request, env, url);
    }
    if (pathname === '/deploy/docs') {
      return Response.redirect(`${url.origin}${DOCS}`, 301);
    }
    if (pathname.startsWith(DASHBOARD)) {
      return serveDashboard(request, env, url);
    }
    if (pathname.startsWith(DOCS)) {
      return serveDocs(request, env, url);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function serveDashboard(request, env, url) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) {
    return asset;
  }
  // Client-side routes (/deploy/dashboard/builds/<id>) have no file of their
  // own, so a hard refresh falls back to the app shell. Missing hashed assets
  // stay 404s — serving HTML for a .js request only hides the real error.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return asset;
  }
  // Fetch the directory, not index.html: asset html_handling redirects
  // /index.html to /, which would bounce the browser off its deep link.
  return env.ASSETS.fetch(new Request(`${url.origin}${DASHBOARD}`, request));
}

/**
 * The docs are a multi-page static site (cleanUrls: /guide/x serves x.html), so
 * there is no SPA fallback: an unknown page gets VitePress's 404 page, with a
 * real 404 status so it is never indexed or cached as content.
 */
async function serveDocs(request, env, url) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) {
    return asset;
  }
  // Extensionless, like the dashboard fallback: html_handling answers 404.html
  // with a redirect to /404, whose empty body would become the error page.
  const notFound = await env.ASSETS.fetch(new Request(`${url.origin}${DOCS}404`, request));
  return new Response(notFound.body, { status: 404, headers: notFound.headers });
}

async function handleInstall(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const [, , dispatchId, file] = url.pathname.split('/');
  if (!isDispatchId(dispatchId)) {
    return htmlResponse(notFoundPage('This install link is malformed.'), 404);
  }
  const prefix = buildPrefix(dispatchId);
  const metaObject = await env.BUILDS.get(`${prefix}meta.json`);
  if (!metaObject) {
    return htmlResponse(
      notFoundPage(
        'No installable build was published under this link. Only internal-distribution builds are published, and only when the repo has EAS_INSTALL_URL and EAS_INSTALL_TOKEN configured.'
      ),
      404
    );
  }
  const meta = await metaObject.json();
  const base = `${url.origin}/install/${dispatchId.toLowerCase()}`;
  const binary = meta.platform === 'ios' ? 'app.ipa' : 'app.apk';

  if (!file) {
    // The workflow records the UDIDs the build was actually signed for; the
    // registry turns them into names, and the cookie set at registration says
    // whether the phone holding the page is one of them.
    const provisioned = Array.isArray(meta.provisionedDevices) ? meta.provisionedDevices : null;
    const page = installPage({
      meta,
      pageUrl: base,
      manifestUrl: `${base}/manifest.plist`,
      fileUrl: `${base}/${binary}`,
      device: devicePlatform(request.headers.get('user-agent') ?? ''),
      provisionedDevices: provisioned && env.DB ? await describeUdids(env.DB, provisioned) : provisioned?.map((udid) => ({ udid })),
      viewerUdid: normalizeUdid(readCookie(request, UDID_COOKIE)),
    });
    return htmlResponse(page, 200);
  }

  if (file === 'manifest.plist' && meta.platform === 'ios') {
    return new Response(
      iosManifest({
        ipaUrl: `${base}/app.ipa`,
        bundleId: meta.bundleId,
        version: meta.version,
        title: meta.name,
      }),
      { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  if (file === binary) {
    const object = await env.BUILDS.get(`${prefix}${binary}`);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers({
      'content-type': CONTENT_TYPES[binary],
      'cache-control': 'private, max-age=300',
      etag: object.httpEtag,
    });
    if (object.size) headers.set('content-length', String(object.size));
    if (binary === 'app.apk') {
      const name = `${(meta.name ?? 'app').replace(/[^\w.-]+/g, '-')}-${meta.version ?? ''}.apk`;
      headers.set('content-disposition', `attachment; filename="${name}"`);
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  }

  return new Response('Not found', { status: 404 });
}

/**
 * Upload API for the build workflow. Small files go up in one PUT; binaries use
 * R2 multipart (create → part… → complete) so an IPA larger than the Workers
 * request-body limit still fits.
 */
async function handleUpload(request, env, url) {
  if (!(await authorized(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }
  const target = parseUploadKey(decodeURIComponent(url.pathname.slice('/api/uploads/'.length)));
  if (!target) {
    return json({ error: 'key must be builds/<dispatch-id>/(meta.json|app.ipa|app.apk)' }, 400);
  }
  const key = `${buildPrefix(target.dispatchId)}${target.file}`;
  const httpMetadata = { contentType: CONTENT_TYPES[target.file] };
  const mpu = url.searchParams.get('mpu');

  if (!mpu && request.method === 'PUT') {
    const object = await env.BUILDS.put(key, request.body, { httpMetadata });
    return json({ key, size: object.size });
  }
  if (mpu === 'create' && request.method === 'POST') {
    const upload = await env.BUILDS.createMultipartUpload(key, { httpMetadata });
    return json({ key, uploadId: upload.uploadId });
  }

  const uploadId = url.searchParams.get('uploadId');
  if (!uploadId) {
    return json({ error: 'uploadId is required' }, 400);
  }
  const upload = env.BUILDS.resumeMultipartUpload(key, uploadId);

  if (mpu === 'part' && request.method === 'PUT') {
    const partNumber = Number(url.searchParams.get('partNumber'));
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return json({ error: 'partNumber must be a positive integer' }, 400);
    }
    const part = await upload.uploadPart(partNumber, request.body);
    return json(part);
  }
  if (mpu === 'complete' && request.method === 'POST') {
    const { parts } = await request.json();
    const object = await upload.complete(parts);
    return json({ key, size: object.size });
  }
  if (mpu === 'abort' && request.method === 'DELETE') {
    await upload.abort();
    return json({ key, aborted: true });
  }
  return json({ error: 'unsupported upload request' }, 400);
}

/**
 * The device registry. GET lists, POST adds (or re-adds) a device, PATCH and
 * DELETE change one. DELETE only disables: the row stays, the device drops out
 * of the next ad-hoc profile, and Apple's own record is left alone.
 *
 *   GET    /api/devices[?status=pending]
 *   POST   /api/devices                 { udid, name, product?, deviceClass?, source }
 *   POST   /api/devices/requests        → { token, url, expiresAt }: a registration QR
 *   GET    /api/devices/<udid>
 *   PATCH  /api/devices/<udid>          { name?, status?, appleDeviceId?, appleTeamId? }
 *   DELETE /api/devices/<udid>
 */
async function handleDevicesApi(request, env, url) {
  if (!(await authorized(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.DB) {
    return json({ error: 'the device registry is not configured: bind a D1 database as DB' }, 503);
  }
  const rest = url.pathname.slice('/api/devices'.length).replace(/^\//, '');
  const { method } = request;
  try {
    if (!rest && method === 'GET') {
      return json({ devices: await listDevices(env.DB, { status: url.searchParams.get('status') || undefined }) });
    }
    if (!rest && method === 'POST') {
      return json({ device: await upsertDevice(env.DB, await readJson(request)) }, 201);
    }
    if (rest === 'requests' && method === 'POST') {
      const created = await createRegistrationRequest(env.DB);
      return json({ ...created, url: `${url.origin}/register-device/${created.token}` }, 201);
    }
    if (rest && !rest.includes('/')) {
      const udid = decodeURIComponent(rest);
      let device;
      if (method === 'GET') device = await getDevice(env.DB, udid);
      else if (method === 'PATCH') device = await updateDevice(env.DB, udid, await readJson(request));
      else if (method === 'DELETE') device = await updateDevice(env.DB, udid, { status: 'disabled' });
      else return json({ error: 'method not allowed' }, 405);
      return device ? json({ device }) : json({ error: 'no such device' }, 404);
    }
  } catch (err) {
    if (err instanceof DeviceInputError || err instanceof SyntaxError) {
      return json({ error: err.message }, 400);
    }
    throw err;
  }
  return json({ error: 'unsupported device request' }, 404);
}

/**
 * The public half of registration, all keyed by an unexpired token:
 *
 *   GET  /register-device/<token>                       landing page (QR on a desktop)
 *   GET  /register-device/<token>/profile.mobileconfig  the enrollment profile
 *   POST /register-device/<token>/callback              iOS posts the device's attributes
 *   GET  /register-device/<token>/done?udid=…           confirmation, opened by iOS in Safari
 */
async function handleRegistration(request, env, url) {
  if (!env.DB) {
    return htmlResponse(registrationErrorPage('Device registration is not set up on this server.'), 503);
  }
  const [, , token, step] = url.pathname.split('/');
  const live = await liveRegistrationRequest(env.DB, token);
  if (!live) {
    return htmlResponse(
      registrationErrorPage('This registration link is unknown or has expired. Ask for a new one: rnd device:create.'),
      404
    );
  }
  const base = `${url.origin}/register-device/${token}`;

  if (!step && request.method === 'GET') {
    const device = devicePlatform(request.headers.get('user-agent') ?? '');
    return htmlResponse(registrationPage({ pageUrl: base, profileUrl: `${base}/profile.mobileconfig`, device }), 200);
  }
  if (step === 'profile.mobileconfig' && request.method === 'GET') {
    return new Response(enrollmentProfile({ callbackUrl: `${base}/callback`, token }), {
      headers: {
        'content-type': 'application/x-apple-aspen-config',
        'content-disposition': 'attachment; filename="register-device.mobileconfig"',
        'cache-control': 'no-store',
      },
    });
  }
  if (step === 'callback' && request.method === 'POST') {
    const attrs = parseDeviceAttributes(new Uint8Array(await request.arrayBuffer()));
    const udid = normalizeUdid(attrs?.UDID);
    if (!udid || attrs.CHALLENGE !== token) {
      return new Response('Bad registration response', { status: 400 });
    }
    await upsertDevice(env.DB, {
      udid,
      name: attrs.DEVICE_NAME,
      product: attrs.PRODUCT,
      osVersion: attrs.VERSION,
      source: 'url',
      registrationToken: token,
    });
    // A 301 is what the Profile Service flow expects: iOS finishes the install
    // and opens the Location in Safari.
    return new Response(null, { status: 301, headers: { location: `${base}/done?udid=${encodeURIComponent(udid)}` } });
  }
  if (step === 'done' && request.method === 'GET') {
    const device = await getDevice(env.DB, url.searchParams.get('udid'));
    // Only a device that came through this very link: the page must not become
    // a lookup for arbitrary UDIDs.
    const row = device && (await env.DB.prepare('SELECT registration_token FROM devices WHERE udid = ?').bind(device.udid).first());
    if (!device || row?.registration_token !== token) {
      return htmlResponse(registrationErrorPage('This device was not registered through this link.'), 404);
    }
    const response = htmlResponse(registeredPage({ device }), 200);
    // Lets an install page warn before installing a build this phone is not in.
    response.headers.append(
      'set-cookie',
      `${UDID_COOKIE}=${encodeURIComponent(device.udid)}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
    );
    return response;
  }
  return new Response('Not found', { status: 404 });
}

const UDID_COOKIE = 'rnd_udid';

function readCookie(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function readJson(request) {
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DeviceInputError('body must be a JSON object');
  }
  return body;
}

/** Constant-time bearer check, so the token cannot be recovered by timing. */
async function authorized(request, env) {
  const expected = env.UPLOAD_TOKEN;
  const header = request.headers.get('authorization') ?? '';
  if (!expected || !header.startsWith('Bearer ')) {
    return false;
  }
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
