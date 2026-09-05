import { requireToken } from './auth.js';

const API_ROOT = process.env.RN_BUILD_GITHUB_API || 'https://api.github.com';

function headers(token, extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rn-build',
    ...extra,
  };
}

async function toError(res, path) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || '';
    if (body.errors?.length) {
      detail += ': ' + body.errors.map((e) => e.message || e.code).join(', ');
    }
  } catch {
    detail = await res.text().catch(() => '');
  }

  if (res.status === 401) {
    return new Error(`GitHub rejected the token (401). Run "rn-build login" with a fresh PAT.`);
  }
  if (res.status === 403 && /rate limit/i.test(detail)) {
    return new Error(`GitHub rate limit hit. Retry in a few minutes.`);
  }
  if (res.status === 404) {
    return new Error(
      `GitHub returned 404 for ${path}. Either the repo doesn't exist, or your token ` +
      `lacks the "repo" scope for it.`
    );
  }
  return new Error(`GitHub API ${res.status} on ${path}${detail ? `: ${detail}` : ''}`);
}

export async function ghRequest(method, path, { body, raw = false, accept } = {}) {
  const token = requireToken();
  const url = path.startsWith('http') ? path : `${API_ROOT}${path}`;

  const res = await fetch(url, {
    method,
    headers: headers(token, {
      ...(accept ? { Accept: accept } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }),
    body: body ? JSON.stringify(body) : undefined,
    redirect: raw ? 'follow' : 'follow',
  });

  if (!res.ok) throw await toError(res, path);
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const gh = {
  get: (path, opts) => ghRequest('GET', path, opts),
  post: (path, body) => ghRequest('POST', path, { body }),
  put: (path, body) => ghRequest('PUT', path, { body }),
  patch: (path, body) => ghRequest('PATCH', path, { body }),
  delete: (path) => ghRequest('DELETE', path),
};

/** Splits "owner/name" and fails loudly on the common "just the name" mistake. */
export function parseRepo(slug) {
  if (!slug || !slug.includes('/')) {
    throw new Error(`Repo must be "owner/name", got "${slug || '(empty)'}".`);
  }
  const [owner, repo] = slug.split('/');
  return { owner, repo };
}

export async function getViewer() {
  return gh.get('/user');
}

export async function getRepo(slug) {
  const { owner, repo } = parseRepo(slug);
  return gh.get(`/repos/${owner}/${repo}`);
}

/**
 * Reports which of the token's scopes GitHub actually granted. Fine-grained
 * tokens return no scope header at all — that is not an error, so we return
 * null and let the caller fall back to trying the operation.
 */
export async function getTokenScopes() {
  const res = await ghRequest('GET', '/user', { raw: true });
  const header = res.headers.get('x-oauth-scopes');
  if (header === null) return null;
  return header.split(',').map((s) => s.trim()).filter(Boolean);
}
