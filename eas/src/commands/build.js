import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDispatchInputs, isPaidOnlyRunner, resolveArtifactExtension, validateBuildable } from '../build/plan.js';
import { BuildService } from '../build/service.js';
import { EasJsonAccessor } from '../easjson/accessor.js';
import { EasJsonUtils } from '../easjson/utils.js';
import { clientFor } from '../github/api.js';
import { BuildStatus, describeBuild } from '../models/build.js';
import { Log, die, formatDuration, formatRelative, link, printJson, setJsonMode } from '../utils/logger.js';
import { loadProjectContext } from '../utils/project.js';

/** Platforms a `--platform` flag expands to, matching EAS's own handling of `all`. */
function requestedPlatforms(value, easJsonPlatformHint) {
  const requested = value ?? easJsonPlatformHint ?? 'all';
  return requested === 'all' ? ['android', 'ios'] : [requested];
}

function context() {
  const project = loadProjectContext();
  if (!project.hasEasJson) {
    die(
      'eas.json could not be found in this project. Run "eas build:configure" to create one.'
    );
  }
  const accessor = EasJsonAccessor.fromProjectPath(project.projectRoot);
  return { project, accessor };
}

export async function build({ options }) {
  setJsonMode(options.json);
  const { project, accessor } = context();
  const profileName = options.profile ?? 'production';

  if (options.local) {
    die(
      'Local builds are not supported by this replacement — the point of it is that the ' +
        'macOS runner is GitHub\'s. Drop --local to build on a runner.'
    );
  }

  const client = clientFor(project.repo);
  const service = new BuildService({
    client,
    app: { name: project.appConfig.name, slug: project.appConfig.slug, appIdentifier: project.appConfig.ios.bundleIdentifier, sdkVersion: project.appConfig.sdkVersion },
    account: { name: project.repo?.split('/')[0] ?? null },
  });

  const platforms = requestedPlatforms(options.platform);
  const ref = project.git.branch ?? 'main';
  const started = [];

  for (const platform of platforms) {
    let profile;
    try {
      profile = await EasJsonUtils.getBuildProfileAsync(accessor, platform, profileName);
    } catch (err) {
      die(err.message);
    }

    for (const warning of await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
      accessor,
      platform,
      profileName
    )) {
      warning.message.forEach((line) => Log.warn(line));
      if (warning.docsUrl) Log.log(`  ${link(warning.docsUrl)}`);
    }

    const errors = validateBuildable({ platform, profile });
    if (errors.length) {
      die(errors.join('\n'));
    }

    const inputs = buildDispatchInputs({
      platform,
      profile,
      profileName,
      ref,
      lockfiles: project.lockfiles,
      appConfig: project.appConfig,
    });
    inputs.message = options.message ?? '';
    inputs.clear_cache = String(Boolean(options.clearCache));

    if (isPaidOnlyRunner(inputs.runner)) {
      Log.warn(
        `Profile "${profileName}" asks for resourceClass "${profile.resourceClass}", which runs on ` +
          `${inputs.runner}. Larger macOS runners are never covered by included minutes — this build bills per-minute.`
      );
    }
    if (project.git.isDirty) {
      Log.warn('Your working tree has uncommitted changes. The runner builds the pushed commit, not your local files.');
    }

    Log.log(
      `${chalk.bold('›')} Building ${chalk.cyan(platform)} with profile ${chalk.cyan(profileName)} on ${chalk.dim(inputs.runner)}`
    );

    const build = await service.dispatchBuild({ ref, inputs });
    started.push(build);
    Log.succeed(`Build started — ${link(build.artifacts.buildUrl)}`);
  }

  if (options.json) {
    // EAS emits an array here even for a single platform, so scripts can index it.
    printJson(started);
    return;
  }

  if (!options.wait) {
    Log.log('');
    Log.log('Not waiting for the build to finish (--no-wait). Re-attach with "eas build:list".');
    return;
  }

  await waitForBuilds({ service, builds: started, output: options.output });
}

/** Polls until every build settles, printing phase transitions as they land. */
async function waitForBuilds({ service, builds, output, pollMs = 10_000 }) {
  const pending = new Map(builds.map((b) => [b._githubRunId, b]));
  const finished = [];

  while (pending.size) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    for (const runId of [...pending.keys()]) {
      const build = await service.getBuildByRunId(runId);
      const settled = [BuildStatus.FINISHED, BuildStatus.ERRORED, BuildStatus.CANCELED].includes(
        build.status
      );
      if (settled) {
        pending.delete(runId);
        finished.push(build);
        printBuildResult(build);
      }
    }
  }

  if (finished.some((b) => b.status !== BuildStatus.FINISHED)) {
    process.exitCode = 1;
  }
  if (output) {
    Log.log(`Artifacts are downloadable with "eas build:download --build-id <id> --output ${output}".`);
  }
}

function printBuildResult(build) {
  const duration = formatDuration(build.metrics.buildDuration);
  if (build.status === BuildStatus.FINISHED) {
    Log.succeed(`${describeBuild(build)} finished in ${duration}`);
    if (build.artifacts.applicationArchiveUrl) {
      Log.log(`  ${link(build.artifacts.applicationArchiveUrl)}`);
    }
  } else if (build.status === BuildStatus.CANCELED) {
    Log.warn(`${describeBuild(build)} was canceled`);
  } else {
    Log.fail(`${describeBuild(build)} failed after ${duration}`);
    if (build.error) {
      Log.log(`  ${build.error.errorCode}: ${build.error.message}`);
      if (build.error.docsUrl) Log.log(`  ${link(build.error.docsUrl)}`);
    }
  }
}

export async function buildList({ options }) {
  setJsonMode(options.json);
  const { project } = context();
  const service = new BuildService({
    client: clientFor(project.repo),
    app: { name: project.appConfig.name, slug: project.appConfig.slug },
    account: { name: project.repo?.split('/')[0] ?? null },
  });

  const builds = await service.listBuilds({
    limit: Number(options.limit ?? 10),
    offset: Number(options.offset ?? 0),
    filters: {
      platform: options.platform,
      status: options.status,
      distribution: options.distribution,
      buildProfile: options.buildProfile ?? options.profile,
      channel: options.channel,
      appVersion: options.appVersion,
      gitCommitHash: options.gitCommitHash,
      simulator: options.simulator,
    },
  });

  if (options.json) {
    printJson(builds);
    return;
  }
  if (!builds.length) {
    Log.log('No builds found.');
    return;
  }
  for (const build of builds) {
    Log.log('');
    Log.log(`${statusIcon(build.status)} ${chalk.bold(describeBuild(build))} ${chalk.dim(build.appVersion ?? '')}`);
    Log.log(
      `  ${chalk.dim(build.id)}  ${formatRelative(build.createdAt)}  ${formatDuration(build.metrics.buildDuration)}`
    );
    Log.log(
      `  profile ${chalk.cyan(build.buildProfile ?? '—')}  commit ${chalk.dim((build.gitCommitHash ?? '').slice(0, 7))}`
    );
  }
  Log.log('');
}

function statusIcon(status) {
  switch (status) {
    case BuildStatus.FINISHED:
      return chalk.green('✔');
    case BuildStatus.ERRORED:
      return chalk.red('✖');
    case BuildStatus.CANCELED:
      return chalk.yellow('⊘');
    default:
      return chalk.blue('●');
  }
}

export async function buildView({ args, options }) {
  setJsonMode(options.json);
  const [buildId] = args;
  const { project } = context();
  const service = new BuildService({
    client: clientFor(project.repo),
    app: { name: project.appConfig.name, slug: project.appConfig.slug },
    account: { name: project.repo?.split('/')[0] ?? null },
  });

  const build = buildId
    ? await service.findBuild(buildId)
    : (await service.listBuilds({ limit: 1 }))[0];

  if (!build) {
    die(buildId ? `No build found with id "${buildId}".` : 'This project has no builds yet.');
  }

  if (options.json) {
    printJson(build);
    return;
  }

  Log.log('');
  Log.log(`${statusIcon(build.status)} ${chalk.bold(describeBuild(build))}`);
  Log.log(`  ${chalk.dim('ID')}          ${build.id}`);
  Log.log(`  ${chalk.dim('Status')}      ${build.status}`);
  Log.log(`  ${chalk.dim('Profile')}     ${build.buildProfile ?? '—'}`);
  Log.log(`  ${chalk.dim('Version')}     ${build.appVersion ?? '—'}${build.appBuildVersion ? ` (${build.appBuildVersion})` : ''}`);
  Log.log(`  ${chalk.dim('Commit')}      ${(build.gitCommitHash ?? '—').slice(0, 7)}`);
  Log.log(`  ${chalk.dim('Started')}     ${build.createdAt ?? '—'}`);
  Log.log(`  ${chalk.dim('Queue time')}  ${formatDuration(build.metrics.buildQueueTime)}`);
  Log.log(`  ${chalk.dim('Build time')}  ${formatDuration(build.metrics.buildDuration)}`);
  Log.log(`  ${chalk.dim('Logs')}        ${link(build.artifacts.buildUrl ?? '—')}`);
  if (build.artifacts.applicationArchiveUrl) {
    Log.log(`  ${chalk.dim('Artifact')}    ${link(build.artifacts.applicationArchiveUrl)}`);
  }
  if (build._phases?.length) {
    Log.log('');
    for (const phase of build._phases) {
      Log.log(`  ${statusIcon(phase.status)} ${phase.name.padEnd(42)} ${chalk.dim(formatDuration(phase.durationSeconds))}`);
    }
  }
  Log.log('');
}

export async function buildCancel({ args, options }) {
  const [buildId] = args;
  const { project } = context();
  const service = new BuildService({ client: clientFor(project.repo) });

  const build = buildId
    ? await service.findBuild(buildId)
    : (await service.listBuilds({ limit: 1 }))[0];
  if (!build) {
    die('No build to cancel.');
  }
  const settled = [BuildStatus.FINISHED, BuildStatus.ERRORED, BuildStatus.CANCELED];
  if (settled.includes(build.status)) {
    Log.log(`Build ${build.id} already ${build.status.toLowerCase()}; nothing to cancel.`);
    return;
  }
  await service.cancelBuild(build);
  Log.succeed(`Canceled build ${build.id}. Runner minutes stop billing once the run winds down.`);
}

export async function buildDownload({ options }) {
  setJsonMode(options.json);
  const { project } = context();
  const service = new BuildService({ client: clientFor(project.repo) });

  // listBuilds only reads runs, not their artifacts, so the latest build has to
  // be re-fetched in full before it has an archive URL to download.
  const latest = options.buildId
    ? null
    : (await service.listBuilds({ limit: 1, filters: { platform: options.platform } }))[0];
  const build = options.buildId
    ? await service.findBuild(options.buildId)
    : latest && (await service.getBuildByRunId(latest._githubRunId));

  if (!build) {
    die('No build found to download.');
  }
  if (!build.artifacts.applicationArchiveUrl) {
    die(
      `Build ${build.id} has no application archive. ` +
        (build.status === 'FINISHED'
          ? 'Its artifacts may have expired — GitHub keeps them for 90 days.'
          : `The build is ${build.status.toLowerCase()}.`)
    );
  }

  const outputDir = options.output ?? join(project.projectRoot, 'build');
  mkdirSync(outputDir, { recursive: true });

  const client = clientFor(project.repo);
  const artifactId = new URL(build.artifacts.applicationArchiveUrl).pathname.match(/artifacts\/(\d+)/)?.[1];
  const response = await client.downloadArtifact(artifactId);
  const buffer = Buffer.from(await response.arrayBuffer());

  // GitHub always hands back a zip, whatever is inside it.
  const target = join(outputDir, `${build.id}.zip`);
  writeFileSync(target, buffer);

  if (options.json) {
    printJson({ path: target, buildId: build.id });
    return;
  }
  Log.succeed(`Downloaded ${target} (${(buffer.length / 1e6).toFixed(1)} MB)`);
  Log.log(`  unzip it to get the .${resolveArtifactExtension(build.platform.toLowerCase(), { distribution: build.distribution.toLowerCase(), simulator: build.isForIosSimulator })}`);
}

/**
 * Writes an eas.json if the project has none. The profiles match what
 * `eas build:configure` generates, so a project configured here and one
 * configured by EAS start from the same file.
 */
export async function buildConfigure() {
  const project = loadProjectContext();
  const target = join(project.projectRoot, 'eas.json');

  if (existsSync(target)) {
    Log.log('eas.json already exists — leaving it alone.');
  } else {
    const easJson = {
      cli: { version: '>= 5.2.0', appVersionSource: 'local' },
      build: {
        development: {
          developmentClient: true,
          distribution: 'internal',
        },
        preview: {
          distribution: 'internal',
        },
        production: {
          autoIncrement: true,
        },
      },
      submit: {
        production: {},
      },
    };
    writeFileSync(target, `${JSON.stringify(easJson, null, 2)}\n`);
    Log.succeed('Created eas.json');
  }

  const workflowDir = join(project.projectRoot, '.github', 'workflows');
  const workflowPath = join(workflowDir, 'eas-build.yml');
  if (existsSync(workflowPath)) {
    Log.log('.github/workflows/eas-build.yml already exists — leaving it alone.');
  } else {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const template = fileURLToPath(new URL('../../templates/eas-build.yml', import.meta.url));
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(workflowPath, readFileSync(template, 'utf-8'));
    Log.succeed('Created .github/workflows/eas-build.yml');
    Log.log('  Commit and push it — GitHub can only dispatch a workflow that exists on the branch.');
  }
}

export async function buildVersionGet({ options }) {
  setJsonMode(options.json);
  const { project } = context();
  const platforms = requestedPlatforms(options.platform);
  const versions = {};
  for (const platform of platforms) {
    versions[platform] =
      platform === 'ios'
        ? project.appConfig.ios.buildNumber
        : project.appConfig.android.versionCode;
  }
  if (options.json) {
    printJson(versions);
    return;
  }
  for (const [platform, version] of Object.entries(versions)) {
    Log.log(`${platform}: ${version ?? '—'}`);
  }
  if (project.appConfig.isDynamic) {
    Log.warn(
      'This project uses a dynamic app config, so these values come from app.json only. ' +
        'An app.config.js may compute something different at prebuild time.'
    );
  }
}

export async function buildVersionSet() {
  die(
    'Version numbers live in your app config, not on a server. Edit "version" and ' +
      '"ios.buildNumber" / "android.versionCode" in app.json, or set "autoIncrement" on the build profile.'
  );
}
