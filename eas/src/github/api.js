import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The GitHub REST client. This is the closest thing to "EAS's servers" that this
 * replacement has: workflow runs are the builds, run artifacts are the build
 * artifacts, and repo secrets hold the signing assets.
 */

const API = 'https://api.github.com';
const AUTH_PATH = join(homedir(), '.eas-gh', 'auth.json');

export function authPath() {
  return AUTH_PATH;
}

/**
 * Tokens live outside the project, mode 0600. Writing one into the repo is how
 * they end up on npm, so the file is deliberately somewhere a `git add -A`
 * cannot reach.
 */
export function saveToken(token, account) {
  mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_PATH, JSON.stringify({ token, account }, null, 2));
  chmodSync(AUTH_PATH, 0o600);
}

export function readAuth() {
  // A token in the environment wins, so CI needs no interactive login.
  const envToken = process.env.EAS_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (envToken) {
    return { token: envToken, account: null, source: 'environment' };
  }
  if (!existsSync(AUTH_PATH)) {
    return null;
  }
  try {
    return { ...JSON.parse(readFileSync(AUTH_PATH, 'utf-8')), source: 'file' };
  } catch {
    return null;
  }
}

export function clearToken() {
  if (existsSync(AUTH_PATH)) {
    writeFileSync(AUTH_PATH, '{}');
  }
}

export class GitHubError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class GitHubClient {
  constructor({ token, repo }) {
    this.token = token;
    this.repo = repo;
  }

  async request(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'rn-eas',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      // Artifact downloads answer with a redirect to a signed blob URL that
      // must be followed *without* the Authorization header, or S3 rejects it.
      redirect: raw ? 'follow' : 'follow',
    });

    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
      throw new GitHubError(
        `GitHub API ${method} ${path} failed (${response.status}): ${parsed.message ?? text}`,
        { status: response.status, body: parsed }
      );
    }
    return raw ? response : response.json();
  }

  /** Verifies a token and reports which scopes it carries. */
  async verifyToken() {
    const response = await this.request('/user', { raw: true });
    const scopes = (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const user = await response.json();
    return { login: user.login, id: user.id, name: user.name, scopes };
  }

  repoInfo() {
    return this.request(`/repos/${this.repo}`);
  }

  /**
   * Starts a build. `workflow_dispatch` answers 204 with no body — it does not
   * tell you which run it created — so the caller correlates by stamping a
   * dispatch id into the workflow's `run-name` and polling for it.
   */
  async dispatchWorkflow({ workflow, ref, inputs }) {
    await this.request(`/repos/${this.repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      body: { ref, inputs },
    });
  }

  listRuns({ workflow, perPage = 30, page = 1, branch, status, event } = {}) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    if (branch) params.set('branch', branch);
    if (status) params.set('status', status);
    if (event) params.set('event', event);
    const base = workflow
      ? `/repos/${this.repo}/actions/workflows/${workflow}/runs`
      : `/repos/${this.repo}/actions/runs`;
    return this.request(`${base}?${params}`);
  }

  getRun(runId) {
    return this.request(`/repos/${this.repo}/actions/runs/${runId}`);
  }

  listJobs(runId) {
    return this.request(`/repos/${this.repo}/actions/runs/${runId}/jobs?per_page=100`);
  }

  listArtifacts(runId) {
    return this.request(`/repos/${this.repo}/actions/runs/${runId}/artifacts?per_page=100`);
  }

  cancelRun(runId) {
    return this.request(`/repos/${this.repo}/actions/runs/${runId}/cancel`, { method: 'POST' });
  }

  downloadArtifact(artifactId) {
    return this.request(
      `/repos/${this.repo}/actions/artifacts/${artifactId}/zip`,
      { raw: true }
    );
  }

  getPublicKey() {
    return this.request(`/repos/${this.repo}/actions/secrets/public-key`);
  }

  putSecret({ name, encryptedValue, keyId }) {
    return this.request(`/repos/${this.repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: { encrypted_value: encryptedValue, key_id: keyId },
    });
  }

  listSecrets() {
    return this.request(`/repos/${this.repo}/actions/secrets?per_page=100`);
  }

  deleteSecret(name) {
    return this.request(`/repos/${this.repo}/actions/secrets/${name}`, { method: 'DELETE' });
  }
}

/** Builds a client from stored auth, with a clear error when there is none. */
export function clientFor(repo) {
  const auth = readAuth();
  if (!auth?.token) {
    throw new Error(
      'Not logged in. Run "rnd login" to store a GitHub token, or set EAS_GITHUB_TOKEN.'
    );
  }
  if (!repo) {
    throw new Error(
      'Could not determine the GitHub repository for this project. Add an "origin" remote pointing at GitHub.'
    );
  }
  return new GitHubClient({ token: auth.token, repo });
}
