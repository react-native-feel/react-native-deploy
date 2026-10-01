import { sha256Hex } from './sha256.js';

/**
 * The Build record, shaped exactly like EAS's GraphQL `BuildFragment`.
 *
 * There is no Expo backend behind this, so the source of truth is the GitHub
 * Actions run itself: its status, its dispatch inputs, its artifacts, its steps.
 * Everything below is a projection of one workflow run onto the shape `eas
 * build:list --json`, `eas build:view` and the dashboard already expect. Keeping
 * the fragment's field names — including the ones we cannot populate, which stay
 * `null` rather than disappearing — is what lets existing tooling read our output.
 */

export const BuildStatus = {
  NEW: 'NEW',
  IN_QUEUE: 'IN_QUEUE',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_CANCEL: 'PENDING_CANCEL',
  FINISHED: 'FINISHED',
  ERRORED: 'ERRORED',
  CANCELED: 'CANCELED',
};

export const AppPlatform = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
};

export const BuildDistributionType = {
  STORE: 'STORE',
  INTERNAL: 'INTERNAL',
  SIMULATOR: 'SIMULATOR',
};

export const BuildMode = {
  BUILD: 'BUILD',
  CUSTOM: 'CUSTOM',
  LOCAL: 'LOCAL',
  REPACK: 'REPACK',
  RESIGN: 'RESIGN',
};

/**
 * GitHub reports progress in two fields — a lifecycle `status` and, only once
 * complete, a `conclusion`. EAS folds both into one enum.
 */
export function toBuildStatus({ status, conclusion }) {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return BuildStatus.FINISHED;
      case 'cancelled':
        return BuildStatus.CANCELED;
      case 'skipped':
      case 'stale':
      case 'neutral':
        return BuildStatus.CANCELED;
      default:
        // failure, timed_out, action_required, and anything new GitHub adds
        return BuildStatus.ERRORED;
    }
  }
  if (status === 'in_progress') {
    return BuildStatus.IN_PROGRESS;
  }
  if (status === 'queued' || status === 'waiting' || status === 'pending') {
    return BuildStatus.IN_QUEUE;
  }
  return BuildStatus.NEW;
}

/**
 * EAS build ids are UUIDs and appear in URLs, `eas build:view`, and the install
 * page. GitHub run ids are short integers. Hashing the run id into a stable
 * v4-shaped UUID gives us EAS-looking ids that never collide across repos and
 * need nothing persisted to map back.
 */
export function buildIdFromRun({ repo, runId }) {
  const hex = sha256Hex(`${repo}#${runId}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Stamp the version/variant nibbles so the result is a well-formed UUID and
    // anything that parses it (the dashboard router, for one) accepts it.
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function secondsBetween(from, to) {
  if (!from || !to) {
    return null;
  }
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

/**
 * Projects a workflow run (plus its jobs and artifacts) onto a Build record.
 *
 * `inputs` are the dispatch inputs the run was started with — they carry the
 * profile name, platform and distribution, which GitHub does not otherwise
 * expose on the run.
 */
export function buildFromWorkflowRun({
  run,
  jobs = [],
  artifacts = [],
  inputs = {},
  app = {},
  account = {},
}) {
  const platform = (inputs.platform ?? '').toLowerCase() === 'ios' ? AppPlatform.IOS : AppPlatform.ANDROID;
  const isSimulator = inputs.simulator === 'true' || inputs.simulator === true;
  const distribution = isSimulator
    ? BuildDistributionType.SIMULATOR
    : inputs.distribution === 'internal'
      ? BuildDistributionType.INTERNAL
      : BuildDistributionType.STORE;

  const status = toBuildStatus(run);
  const startedAt = run.run_started_at ?? run.created_at;
  const completedAt = status === BuildStatus.FINISHED || status === BuildStatus.ERRORED || status === BuildStatus.CANCELED
    ? run.updated_at
    : null;

  // GitHub bills from the moment a job picks up, but the run is created earlier.
  // That gap is genuinely queue time, and it is what EAS shows as "Wait time".
  const queueTime = secondsBetween(run.created_at, startedAt);
  const buildDuration = secondsBetween(startedAt, completedAt);

  const applicationArchive = artifacts.find((a) => /\.(ipa|aab|apk|app|tar\.gz)$/i.test(a.name) || a.name === 'application-archive');
  const buildArtifacts = artifacts.find((a) => a.name === 'build-artifacts');
  const xcodeLogs = artifacts.find((a) => a.name === 'xcode-logs');

  return {
    __typename: 'Build',
    id: buildIdFromRun({ repo: app.repo ?? '', runId: run.id }),
    status,
    platform,
    error: buildError(run, jobs, status),
    artifacts: {
      buildUrl: run.html_url ?? null,
      xcodeBuildLogsUrl: xcodeLogs?.archive_download_url ?? null,
      applicationArchiveUrl: applicationArchive?.archive_download_url ?? null,
      buildArtifactsUrl: buildArtifacts?.archive_download_url ?? null,
    },
    fingerprint: inputs.fingerprint_hash
      ? { id: inputs.fingerprint_hash, hash: inputs.fingerprint_hash }
      : null,
    initiatingActor: run.actor
      ? { __typename: 'User', id: String(run.actor.id), displayName: run.actor.login }
      : null,
    logFiles: [],
    app: {
      __typename: 'App',
      id: app.id ?? null,
      name: app.name ?? null,
      slug: app.slug ?? null,
      ownerAccount: { id: account.id ?? null, name: account.name ?? null },
    },
    updateChannel: inputs.channel ? { id: inputs.channel, name: inputs.channel } : null,
    distribution,
    iosEnterpriseProvisioning:
      inputs.export_method === 'enterprise' ? 'UNIVERSAL' : isSimulator ? null : null,
    buildProfile: inputs.profile ?? null,
    appIdentifier: app.appIdentifier ?? null,
    sdkVersion: app.sdkVersion ?? null,
    appVersion: inputs.app_version || null,
    appBuildVersion: inputs.app_build_version || null,
    runtime: inputs.runtime_version
      ? { id: inputs.runtime_version, version: inputs.runtime_version }
      : null,
    gitCommitHash: run.head_sha ?? null,
    gitCommitMessage: run.head_commit?.message ?? null,
    initialQueuePosition: null,
    queuePosition: null,
    estimatedWaitTimeLeftSeconds: null,
    priority: 'NORMAL',
    createdAt: run.created_at ?? null,
    updatedAt: run.updated_at ?? null,
    message: inputs.message || null,
    completedAt,
    // GitHub keeps artifacts for 90 days by default; that is the real window in
    // which an install link still works, so it is what we report.
    expirationDate: run.created_at
      ? new Date(new Date(run.created_at).getTime() + 90 * 86400_000).toISOString()
      : null,
    isForIosSimulator: isSimulator,
    metrics: {
      buildWaitTime: queueTime,
      buildQueueTime: queueTime,
      buildDuration,
    },
    // Not part of BuildFragment, but the dashboard needs a way back to the run
    // and `eas build:cancel` needs the numeric id.
    _githubRunId: run.id,
    // The random id the CLI stamped into the run name. Unlike the sequential run
    // id it is unguessable, so it keys the public install page for this build.
    _dispatchId: inputs.dispatch_id || null,
    _githubRunNumber: run.run_number ?? null,
    _githubRunAttempt: run.run_attempt ?? null,
    _phases: jobs.flatMap(jobPhases),
  };
}

function buildError(run, jobs, status) {
  if (status !== BuildStatus.ERRORED) {
    return null;
  }
  const failedStep = jobs
    .flatMap((job) => (job.steps ?? []).map((step) => ({ job, step })))
    .find(({ step }) => step.conclusion === 'failure');

  if (!failedStep) {
    return {
      errorCode: 'UNKNOWN_ERROR',
      message: 'The build failed. Open the run on GitHub Actions for the full log.',
      docsUrl: run.html_url ?? null,
    };
  }
  return {
    errorCode: errorCodeForStep(failedStep.step.name),
    message: `Step "${failedStep.step.name}" failed in job "${failedStep.job.name}".`,
    docsUrl: `${run.html_url}/job/${failedStep.job.id}`,
  };
}

/**
 * Maps the failing step onto one of EAS's error codes. Not every EAS code has a
 * counterpart here, but the common ones do, and matching them means existing
 * error-handling scripts keep working.
 */
function errorCodeForStep(stepName = '') {
  const name = stepName.toLowerCase();
  if (name.includes('pod')) return 'INSTALL_PODS_FAILED';
  if (name.includes('dependenc')) return 'NPM_INSTALL_FAILED';
  if (name.includes('prebuild')) return 'EXPO_PREBUILD_FAILED';
  if (name.includes('credential') || name.includes('signing')) return 'CREDENTIALS_ERROR';
  if (name.includes('gradle')) return 'GRADLE_BUILD_FAILED';
  if (name.includes('archive') || name.includes('fastlane') || name.includes('xcodebuild')) {
    return 'XCODE_BUILD_FAILED';
  }
  return 'UNKNOWN_ERROR';
}

/**
 * Flattens a job's steps into the phase list the build detail page renders —
 * the same "Install dependencies / Prebuild / Install pods / Run fastlane"
 * timeline EAS shows, sourced from real runner steps.
 */
function jobPhases(job) {
  return (job.steps ?? [])
    .filter((step) => step.name !== 'Set up job' && step.name !== 'Complete job')
    .map((step) => ({
      key: `${job.id}:${step.number}`,
      job: job.name,
      name: step.name,
      status: toBuildStatus({ status: step.status, conclusion: step.conclusion }),
      durationSeconds: secondsBetween(step.started_at, step.completed_at),
    }));
}

/** EAS's own phrasing for the platform + distribution pair, used as a build's title. */
export function describeBuild(build) {
  const platform = build.platform === AppPlatform.IOS ? 'iOS' : 'Android';
  if (build.isForIosSimulator) {
    return `${platform} simulator build`;
  }
  if (build.distribution === BuildDistributionType.INTERNAL) {
    return `${platform} internal distribution build`;
  }
  return `${platform} production build`;
}
