import { appendFileSync } from 'node:fs';
import { loadConfig, mergeWithFlags, validateLoadedConfig } from '../config/loader.js';
import { resolveProfile } from '../config/profiles.js';
import { LocalSsh } from '../remote/local-exec.js';
import { sshExec } from '../remote/ssh.js';
import { getExpoBuildSteps } from '../build/expo.js';
import { getClassicBuildSteps } from '../build/classic.js';
import { getSimulatorTarballPath } from '../build/simulator.js';
import { downloadSimulatorTarball } from '../build/artifacts.js';
import { distributeBuild } from '../distribute/index.js';
import { logger } from '../utils/logger.js';

// `rn-deploy run-build` runs the build *locally* in the current directory —
// designed to be invoked from inside a CI job (e.g. a GitHub Actions macOS
// runner) where actions/checkout has already placed the repo on disk. It reuses
// the same build steps and distribute pipeline as the SSH path via LocalSsh.
//
// First cut supports distribution: "simulator" only (unsigned, no ASC key) —
// the path the GitHub Actions host targets. Device/ad-hoc signing on a runner
// is a follow-up.
export async function runBuildCommand(options = {}) {
  const rawConfig = loadConfig();
  const config = mergeWithFlags(rawConfig, options);
  validateLoadedConfig(config);

  const profileName = options.profile || 'production';
  let profile = resolveProfile(config.build, profileName);
  if (config._flagOverrides) profile = { ...profile, ...config._flagOverrides };

  const distribution = profile.distribution || 'app-store';
  if (distribution !== 'simulator') {
    throw new Error(
      `run-build currently supports distribution: "simulator" only (got "${distribution}"). ` +
      'Use the AWS/MacinCloud host for signed device builds.'
    );
  }
  if (!profile.scheme) throw new Error('profile.scheme is required');
  if (!profile.buildType) throw new Error('profile.buildType is required (expo or classic)');

  const workDir = process.cwd();
  const ssh = new LocalSsh({ cwd: workDir });

  logger.info(`Running ${profile.buildType} simulator build locally in ${workDir}`);

  const buildSteps = profile.buildType === 'expo'
    ? getExpoBuildSteps({ scheme: profile.scheme, buildConfiguration: profile.buildConfiguration, workDir, distribution })
    : getClassicBuildSteps({ scheme: profile.scheme, buildConfiguration: profile.buildConfiguration, workDir, distribution });

  // Run steps sequentially. The CI job itself is the durable unit, so no tmux.
  const totalSteps = buildSteps.length + 2;
  for (let i = 0; i < buildSteps.length; i++) {
    logger.step(i + 1, totalSteps, buildSteps[i].name);
    await sshExec(ssh, buildSteps[i].cmd, { stream: true });
  }

  // Retrieve the artifact (already local — this just resolves the path).
  logger.step(totalSteps - 1, totalSteps, 'Retrieving build artifact');
  const tarball = getSimulatorTarballPath(workDir, profile.scheme);
  const { localPath, remotePath } = await downloadSimulatorTarball(ssh, tarball, workDir, profile.scheme);

  // Distribute to storage.
  logger.step(totalSteps, totalSteps, 'Distributing build');
  const commit = (await sshExec(ssh, 'git rev-parse --short HEAD')).stdout.trim();
  const metadata = await distributeBuild({
    ssh,
    config,
    profile,
    profileName,
    remoteIpaPath: remotePath,
    signingInfo: null,
    appMeta: {
      title: config.app?.title || profile.scheme,
      slug: config.app?.slug,
      version: config.app?.version,
      buildNumber: config.app?.buildNumber,
      commit,
      branch: config.repo?.branch,
      localIpaPath: localPath,
    },
  });

  if (!metadata) {
    logger.warn('Distribute step produced no metadata (storage not configured?).');
    return;
  }

  writeGithubOutputs({
    'build-id': metadata.id,
    'artifact-url': metadata.artifactUrl,
    'install-page-url': metadata.installPageUrl,
  });

  logger.success(`run-build complete — build ${metadata.id.slice(0, 8)}`);
  logger.info(`Artifact     : ${metadata.artifactUrl}`);
  logger.info(`Install page : ${metadata.installPageUrl}`);
}

// Expose results to subsequent workflow steps via $GITHUB_OUTPUT when present.
export function writeGithubOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(outputs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  if (lines) appendFileSync(file, lines + '\n');
}
