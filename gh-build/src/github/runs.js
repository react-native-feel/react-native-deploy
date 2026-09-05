import { randomUUID } from 'node:crypto';
import { gh, parseRepo } from './api.js';
import { logger } from '../utils/logger.js';

const POLL_INTERVAL_MS = 5000;
const DISCOVERY_TIMEOUT_MS = 90_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function newDispatchId() {
  return randomUUID().slice(0, 8);
}

/**
 * workflow_dispatch returns 204 with no body, so there is no run id to read.
 * We stamp a short id into the workflow's run-name and then look for the run
 * whose display title contains it — reliable even with concurrent dispatches.
 */
export async function dispatchWorkflow(repoSlug, workflowFile, ref, inputs) {
  const { owner, repo } = parseRepo(repoSlug);
  await gh.post(
    `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    { ref, inputs }
  );
}

export async function findRunByDispatchId(repoSlug, workflowFile, dispatchId, since) {
  const { owner, repo } = parseRepo(repoSlug);
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const data = await gh.get(
      `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs` +
      `?event=workflow_dispatch&per_page=30`
    );
    const match = (data.workflow_runs || []).find(
      (run) =>
        (run.display_title || run.name || '').includes(dispatchId) &&
        new Date(run.created_at).getTime() >= since - 60_000
    );
    if (match) return match;
    await sleep(3000);
  }

  throw new Error(
    `Dispatched the workflow but couldn't find the run after 90s. ` +
    `Check the Actions tab: https://github.com/${repoSlug}/actions/workflows/${workflowFile}`
  );
}

export async function getRun(repoSlug, runId) {
  const { owner, repo } = parseRepo(repoSlug);
  return gh.get(`/repos/${owner}/${repo}/actions/runs/${runId}`);
}

export async function getRunJobs(repoSlug, runId) {
  const { owner, repo } = parseRepo(repoSlug);
  const data = await gh.get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return data.jobs || [];
}

export async function cancelRun(repoSlug, runId) {
  const { owner, repo } = parseRepo(repoSlug);
  await gh.post(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`);
}

const STATUS_ICON = {
  success: '✓',
  failure: '✗',
  cancelled: '⊘',
  skipped: '–',
  in_progress: '•',
  queued: '·',
};

/**
 * GitHub does not expose a live log stream over the REST API, so we render a
 * step checklist that redraws as jobs progress. Completed steps are printed
 * once and never reprinted.
 */
export async function watchRun(repoSlug, runId, { onComplete } = {}) {
  const seen = new Set();
  let lastStatus = null;

  for (;;) {
    const run = await getRun(repoSlug, runId);
    const jobs = await getRunJobs(repoSlug, runId);

    for (const job of jobs) {
      for (const step of job.steps || []) {
        const key = `${job.id}:${step.number}`;
        if (step.status !== 'completed' || seen.has(key)) continue;
        seen.add(key);
        const icon = STATUS_ICON[step.conclusion] || '·';
        const elapsed = stepDuration(step);
        logger.plain(`  ${icon} ${job.name} › ${step.name}${elapsed ? ` (${elapsed})` : ''}`);
      }
    }

    if (run.status !== lastStatus) {
      lastStatus = run.status;
      logger.debug(`run status: ${run.status}`);
    }

    if (run.status === 'completed') {
      if (onComplete) await onComplete(run, jobs);
      return { run, jobs };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function stepDuration(step) {
  if (!step.started_at || !step.completed_at) return null;
  const secs = Math.round(
    (new Date(step.completed_at) - new Date(step.started_at)) / 1000
  );
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}

/** Failed steps, for a compact post-mortem instead of dumping the whole log. */
export function failedSteps(jobs) {
  const failures = [];
  for (const job of jobs) {
    for (const step of job.steps || []) {
      if (step.conclusion === 'failure') {
        failures.push({ job: job.name, step: step.name, url: job.html_url });
      }
    }
  }
  return failures;
}

export async function getJobLog(repoSlug, jobId) {
  const { owner, repo } = parseRepo(repoSlug);
  const res = await gh.get(
    `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
    { raw: true }
  );
  return res.text();
}
