import { execFile } from 'node:child_process';
import { logger } from '../utils/logger.js';

// Orchestrates a build on GitHub Actions: dispatch the workflow with `gh`,
// find the run it created, and poll until it finishes. The `gh` runner and the
// clock are injectable so the polling logic is unit-testable without network.

export function workflowRunArgs(host, inputs = {}) {
  const args = ['workflow', 'run', host.workflow, '--repo', host.repo, '--ref', host.ref || 'main'];
  for (const [k, v] of Object.entries(inputs)) {
    if (v !== undefined && v !== null && v !== '') args.push('-f', `${k}=${v}`);
  }
  return args;
}

export function runListArgs(host) {
  return [
    'run', 'list',
    '--workflow', host.workflow,
    '--repo', host.repo,
    '--limit', '5',
    '--json', 'databaseId,status,conclusion,createdAt,headBranch',
  ];
}

export function runViewArgs(host, id) {
  return ['run', 'view', String(id), '--repo', host.repo, '--json', 'status,conclusion,url'];
}

// Default runner: shell out to the gh CLI.
function defaultGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`gh ${args[0]} ${args[1] || ''} failed: ${stderr || err.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const realSleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function triggerGithubActionsBuild({
  host,
  profile,
  message,
  gh = defaultGh,
  sleep = realSleep,
  now = () => Date.now(),
  pollIntervalMs = 10_000,
  timeoutMs = 45 * 60 * 1000,
  log = logger,
}) {
  const start = now();

  log.info(`Dispatching ${host.workflow} on ${host.repo}@${host.ref || 'main'} (profile=${profile})...`);
  await gh(workflowRunArgs(host, { profile, message }));

  // 1. Find the run created by this dispatch. gh doesn't return the run id, so
  //    we poll run-list for a run created at/after our dispatch time.
  let runId = null;
  while (!runId) {
    if (now() - start > timeoutMs) throw new Error('Timed out waiting for the workflow run to appear.');
    const runs = JSON.parse((await gh(runListArgs(host))).stdout || '[]');
    const fresh = runs
      .filter(r => Date.parse(r.createdAt) >= start - 60_000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (fresh) {
      runId = fresh.databaseId;
      log.info(`Workflow run started: ${runId}`);
    } else {
      await sleep(pollIntervalMs);
    }
  }

  // 2. Poll the run to completion.
  for (;;) {
    const run = JSON.parse((await gh(runViewArgs(host, runId))).stdout || '{}');
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Workflow run ${runId} concluded "${run.conclusion}". See ${run.url || host.repo}.`);
      }
      log.success(`Workflow run ${runId} succeeded.`);
      return { runId, conclusion: run.conclusion, url: run.url };
    }
    if (now() - start > timeoutMs) throw new Error(`Timed out waiting for workflow run ${runId}.`);
    await sleep(pollIntervalMs);
  }
}
