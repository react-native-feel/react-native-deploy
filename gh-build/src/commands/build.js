import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import { loadConfig, validateLoadedConfig } from '../config/loader.js';
import { resolveProfile } from '../config/profiles.js';
import { WORKFLOW_FILE } from '../config/schema.js';
import { assertWorkflowPresent } from './workflow.js';
import {
  dispatchWorkflow, findRunByDispatchId, watchRun, failedSteps,
  newDispatchId, getRun, cancelRun,
} from '../github/runs.js';
import { listRunArtifacts, downloadArtifact, formatSize } from '../github/artifacts.js';
import { logger } from '../utils/logger.js';

const STATE_FILE = '.rn-build-state.json';

export async function buildCommand(options = {}) {
  const config = validateLoadedConfig(loadConfig());
  const { repo } = config.github;
  const ref = options.ref || config.github.ref;

  const profileName = options.profile || 'production';
  const profile = resolveProfile(config.build, profileName);

  const platform = options.platform || profile.platform;
  if (platform !== 'android' && !config.ios?.scheme) {
    throw new Error('config.ios.scheme is empty — iOS builds need it. Run "rn-build setup".');
  }

  await assertWorkflowPresent(repo, ref);

  const inputs = buildInputs({ config, profile, profileName, platform, options });

  logger.plain();
  logger.info(`Dispatching ${chalk.bold(profileName)} build of ${chalk.bold(repo)}@${ref}`);
  logger.dim(`  platform    ${platform}`);
  logger.dim(`  type        ${profile.buildType}`);
  if (platform !== 'android') {
    logger.dim(`  scheme      ${config.ios.scheme} (${profile.buildConfiguration}, ${profile.distribution})`);
    logger.dim(`  ios runner  ${profile.iosRunner}`);
  }
  if (platform !== 'ios') {
    logger.dim(`  gradle      :${profile.androidModule}:${profile.gradleTask}`);
    logger.dim(`  and runner  ${profile.androidRunner}`);
  }
  logger.plain();

  const dispatchedAt = Date.now();
  await dispatchWorkflow(repo, WORKFLOW_FILE, ref, inputs);

  const run = await findRunByDispatchId(repo, WORKFLOW_FILE, inputs.dispatch_id, dispatchedAt);
  saveState({ repo, runId: run.id, profile: profileName, url: run.html_url });

  logger.success(`Run #${run.run_number} started`);
  logger.dim(`  ${run.html_url}`);
  logger.plain();

  if (options.detach) {
    logger.info('Detached — follow it with "rn-build status" or the URL above.');
    return { run };
  }

  const onInterrupt = async () => {
    logger.plain();
    logger.warn('Interrupted. The run is still going on GitHub.');
    logger.dim(`  cancel it:  rn-build cancel`);
    logger.dim(`  watch it:   rn-build status --watch`);
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);

  const { run: finished, jobs } = await watchRun(repo, run.id);
  process.off('SIGINT', onInterrupt);

  logger.plain();
  if (finished.conclusion !== 'success') {
    reportFailure(finished, jobs);
    process.exitCode = 1;
    return { run: finished };
  }

  logger.success(`Build succeeded in ${runDuration(finished)}`);
  const files = await downloadArtifacts(repo, finished.id, options.output || join(process.cwd(), 'build'));
  return { run: finished, files };
}

export function buildInputs({ config, profile, profileName, platform, options }) {
  return {
    dispatch_id: newDispatchId(),
    profile: profileName,
    platform,
    build_type: profile.buildType,
    node_version: String(profile.nodeVersion),
    package_manager: profile.packageManager,
    env_json: JSON.stringify(profile.env || {}),

    ios_runner: options.iosRunner || profile.iosRunner,
    scheme: config.ios?.scheme || '',
    configuration: profile.buildConfiguration,
    export_method: profile.distribution,
    team_id: config.ios?.teamId || '',
    bundle_id: config.ios?.bundleId || '',
    profile_name: config.ios?.profileName || '',

    android_runner: options.androidRunner || profile.androidRunner,
    gradle_task: options.gradleTask || profile.gradleTask,
    android_module: config.android?.module || profile.androidModule,
  };
}

async function downloadArtifacts(repo, runId, destDir) {
  const artifacts = await listRunArtifacts(repo, runId);
  if (!artifacts.length) {
    logger.warn('The run succeeded but produced no artifacts.');
    return [];
  }

  const all = [];
  for (const artifact of artifacts) {
    logger.info(`Downloading ${artifact.name} (${formatSize(artifact.size_in_bytes)})...`);
    const files = await downloadArtifact(repo, artifact, destDir);
    all.push(...files);
  }

  logger.plain();
  for (const file of all) {
    logger.success(`${file.path} ${chalk.gray(`(${formatSize(file.size)})`)}`);
  }
  return all;
}

function reportFailure(run, jobs) {
  logger.error(`Build ${run.conclusion} after ${runDuration(run)}`);
  const failures = failedSteps(jobs);
  if (failures.length) {
    logger.plain();
    for (const f of failures) {
      logger.plain(`  ${chalk.red('✗')} ${f.job} › ${chalk.bold(f.step)}`);
    }
  }
  logger.plain();
  logger.dim(`Full logs: ${run.html_url}`);
}

function runDuration(run) {
  const ms = new Date(run.updated_at) - new Date(run.run_started_at || run.created_at);
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return mins ? `${mins}m${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

export function saveState(state) {
  writeFileSync(join(process.cwd(), STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

export function loadState() {
  const path = join(process.cwd(), STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Re-attaches to the last dispatched run, or a specific one via --run. */
export async function statusCommand(options = {}) {
  const config = loadConfig();
  const repo = config.github.repo;
  const state = loadState();
  const runId = options.run || state?.runId;

  if (!runId) {
    throw new Error('No recent build found. Run "rn-build build" first, or pass --run <id>.');
  }

  const run = await getRun(repo, runId);
  logger.plain();
  logger.plain(`${chalk.bold(`Run #${run.run_number}`)} — ${run.display_title}`);
  logger.dim(`  status      ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`);
  logger.dim(`  branch      ${run.head_branch}`);
  logger.dim(`  url         ${run.html_url}`);
  logger.plain();

  if (options.watch && run.status !== 'completed') {
    const { run: finished, jobs } = await watchRun(repo, runId);
    logger.plain();
    if (finished.conclusion === 'success') {
      logger.success(`Build succeeded in ${runDuration(finished)}`);
      await downloadArtifacts(repo, finished.id, options.output || join(process.cwd(), 'build'));
    } else {
      reportFailure(finished, jobs);
      process.exitCode = 1;
    }
  } else if (run.status === 'completed' && run.conclusion === 'success' && options.download) {
    await downloadArtifacts(repo, runId, options.output || join(process.cwd(), 'build'));
  }
}

export async function cancelCommand(options = {}) {
  const config = loadConfig();
  const state = loadState();
  const runId = options.run || state?.runId;
  if (!runId) throw new Error('No run to cancel. Pass --run <id>.');

  await cancelRun(config.github.repo, runId);
  logger.success(`Cancellation requested for run ${runId}. Billing stops once the runner stops.`);
}
