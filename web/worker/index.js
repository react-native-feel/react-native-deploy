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

/**
 * One Worker for everything a tester's phone or browser touches:
 *
 *   /deploy/dashboard/*            the Vite dashboard (static assets, SPA fallback)
 *   /deploy/docs/*                 the VitePress docs (static assets, its own 404 page)
 *   /install/<dispatchId>          public install page a QR code points at
 *   /install/<dispatchId>/manifest.plist   iOS OTA manifest
 *   /install/<dispatchId>/app.ipa|apk      the binary, streamed from R2
 *   /api/uploads/builds/<id>/<file>        workflow-only, bearer UPLOAD_TOKEN
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
    const page = installPage({
      meta,
      pageUrl: base,
      manifestUrl: `${base}/manifest.plist`,
      fileUrl: `${base}/${binary}`,
      device: devicePlatform(request.headers.get('user-agent') ?? ''),
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
