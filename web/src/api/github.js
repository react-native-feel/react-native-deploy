import { buildFromWorkflowRun } from '@eas/models/build.js';

/**
 * The live data source: GitHub Actions, read straight from the browser.
 *
 * There is no server in between, which is the point — the dashboard is a static
 * page and the user's own token talks to GitHub. The token is held in
 * localStorage, never sent anywhere but api.github.com, and a read-only
 * fine-grained token is enough for everything here.
 */

const API = 'https://api.github.com';
const WORKFLOW = 'eas-build.yml';
const TOKEN_KEY = 'rn-eas.github-token';
const REPO_KEY = 'rn-eas.repo';

export function readSettings() {
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY) ?? '',
      repo: localStorage.getItem(REPO_KEY) ?? '',
    };
  } catch {
    // Private windows and blocked site data both throw here; the dashboard
    // still works in demo mode, so this must not be fatal.
    return { token: '', repo: '' };
  }
}

export function writeSettings({ token, repo }) {
  try {
    if (token !== undefined) localStorage.setItem(TOKEN_KEY, token);
    if (repo !== undefined) localStorage.setItem(REPO_KEY, repo);
  } catch {
    /* storage unavailable — settings just do not persist */
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REPO_KEY);
  } catch {
    /* ignore */
  }
}

async function gh(path, { token }) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      response.status === 401
        ? 'GitHub rejected that token. Check it has read access to the repository.'
        : (response.status === 403 || response.status === 429) &&
            response.headers.get('x-ratelimit-remaining') === '0'
          ? token
            ? 'GitHub rate limit reached for this token. Try again in a few minutes.'
            : "GitHub's anonymous limit (60 requests/hour) is used up. Add a read-only token to keep going."
          : response.status === 404
          ? `Repository not found, or the token cannot see it (and its Actions runs).`
          : `GitHub API error ${response.status}: ${body.slice(0, 200)}`
    );
  }
  return response.json();
}

/** Same encoding the CLI writes into `run-name`. */
function parseRunName(runName = '') {
  const match = runName.match(/\[eas:([^\]]+)\]/);
  if (!match) return {};
  const inputs = {};
  for (const pair of match[1].split(';')) {
    const index = pair.indexOf('=');
    if (index > 0) inputs[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
  }
  return inputs;
}

function appFor(repo) {
  const [account, name] = repo.split('/');
  return {
    app: { repo, name, slug: name, appIdentifier: null, sdkVersion: null },
    account: { name: account },
  };
}

export async function fetchBuilds({ token, repo, limit = 50 }) {
  const { workflow_runs: runs = [] } = await gh(
    `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=${limit}`,
    { token }
  );
  const { app, account } = appFor(repo);
  return runs.map((run) =>
    buildFromWorkflowRun({
      run,
      inputs: parseRunName(run.name ?? run.display_title ?? ''),
      app,
      account,
    })
  );
}

/**
 * The detail view needs jobs and artifacts too. Both are fetched in parallel —
 * serially they add a visible pause to a page that is otherwise instant.
 */
export async function fetchBuild({ token, repo, runId }) {
  const [run, jobsResult, artifactsResult] = await Promise.all([
    gh(`/repos/${repo}/actions/runs/${runId}`, { token }),
    gh(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, { token }),
    gh(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, { token }),
  ]);
  const { app, account } = appFor(repo);
  return buildFromWorkflowRun({
    run,
    jobs: jobsResult.jobs ?? [],
    artifacts: artifactsResult.artifacts ?? [],
    inputs: parseRunName(run.name ?? ''),
    app,
    account,
  });
}
