import { loadConfig, mergeWithFlags, validateLoadedConfig } from '../config/loader.js';
import { resolveProfile } from '../config/profiles.js';
import { loadState } from '../infra/state.js';
import { infraUp, infraDown } from './infra.js';
import { createSshConnection, sshExec } from '../remote/ssh.js';
import { connectManagedHost } from '../remote/connect.js';
import { provisionInstance, provisionManagedHost, cloneRepo } from '../remote/provision.js';
import {
  authenticateAsc,
  setupSigning,
  teardownSigning,
  cleanupAscCredentials,
  generateExportOptionsPlist,
} from '../remote/signing.js';
import { resolveAscCredentials } from '../config/credentials.js';
import { getExpoBuildSteps } from '../build/expo.js';
import { getClassicBuildSteps } from '../build/classic.js';
import { getSimulatorTarballPath } from '../build/simulator.js';
import { findAndDownloadIpa, downloadSimulatorTarball } from '../build/artifacts.js';
import { distributeBuild } from '../distribute/index.js';
import { createCustomAmi } from '../infra/ami.js';
import { getPrivateKeyPath } from '../infra/key-pair.js';
import { logger } from '../utils/logger.js';
import { confirm, input, select } from '../utils/prompts.js';
import { verifyPrerequisites } from '../utils/prerequisites.js';
import { submitToTestFlight } from './submit.js';

const TMUX_SESSION = 'rn-deploy-build';
const TMUX_LOG = '/tmp/rn-deploy-build.log';

export async function buildCommand(options = {}) {
  // Handle --resume: reconnect to existing tmux build session
  if (options.resume) {
    return resumeBuild(options);
  }

  // Load and merge config
  const rawConfig = loadConfig();
  const config = mergeWithFlags(rawConfig, options);
  validateLoadedConfig(config);

  // Resolve build profile
  const profileName = options.profile || 'production';
  let profile = resolveProfile(config.build, profileName);

  // Apply flag overrides
  if (config._flagOverrides) {
    profile = { ...profile, ...config._flagOverrides };
  }

  // Interactive prompts for missing values
  if (!options.nonInteractive) {
    if (!config.repo.url) {
      config.repo.url = await input('Git repository URL:');
    }
    if (!profile.scheme) {
      profile.scheme = await input('Xcode scheme name:');
    }
    if (!profile.buildType) {
      profile.buildType = await select('Build type:', ['expo', 'classic']);
    }
  }

  const hostKind = config.host?.kind || 'aws';
  // "Managed" = a host rn-deploy connects to but never provisions/tears down.
  // macincloud is reached over SSH; cua over its cloud-sandbox WebSocket.
  const isManaged = hostKind === 'macincloud' || hostKind === 'cua';

  // Verify local prerequisites now that we know the host + distribution.
  await verifyPrerequisites({ hostKind, distribution: profile.distribution });
  const totalTimeoutMs = (options.timeout || 60) * 60 * 1000;
  const buildStartTime = Date.now();

  // GitHub Actions host: dispatch the workflow and wait — the build runs on the
  // runner via `rn-deploy run-build`. We never touch SSH/infra here.
  if (hostKind === 'github-actions') {
    return runViaGithubActions(config, profile, profileName, options);
  }

  // Step 1: Ensure infrastructure (AWS only — managed hosts already exist)
  let state = null;
  let ssh;
  if (isManaged) {
    const target = hostKind === 'cua' ? `cua sandbox ${config.host.name}` : `managed host ${config.host.host}`;
    logger.step(1, 7, `Using ${target}`);
    logger.step(2, 7, hostKind === 'cua' ? 'Connecting to cua sandbox' : 'Connecting via SSH');
    // connectManagedHost handles both transports and applies the Homebrew
    // shellenv + UTF-8 locale prefix every command needs on a non-login shell.
    ssh = await connectManagedHost(config.host);
  } else {
    const { keyPairName } = config.aws;
    logger.step(1, 7, 'Provisioning infrastructure');
    state = loadState();
    if (!state || !(await isInstanceReachable(state))) {
      state = await infraUp(options);
      if (!state) return;
    } else {
      logger.info(`Reusing existing instance: ${state.instanceId} at ${state.publicIp}`);
    }

    logger.step(2, 7, 'Connecting via SSH');
    const keyPath = state.keyPath || getPrivateKeyPath(keyPairName);
    ssh = await createSshConnection(state.publicIp, keyPath);
  }

  const cloneWorkDir = isManaged ? (config.host.workDir || '~/rn-deploy-work') : '~/build-workspace';

  let hostCaps = { tmux: true };
  try {
    // Step 3: Provision/verify build environment
    if (isManaged) {
      logger.step(3, 7, 'Verifying managed host toolchain');
      hostCaps = await provisionManagedHost(ssh);
    } else if (!config.aws.customAmiId) {
      logger.step(3, 7, 'Setting up build environment');
      await provisionInstance(ssh, {
        nodeVersion: config.aws.nodeVersion,
        xcodeVersion: config.aws.xcodeVersion,
      });
    } else {
      logger.step(3, 7, 'Using custom AMI — skipping provisioning');
    }

    const distribution = profile.distribution || 'app-store';
    const isSimulator = distribution === 'simulator';

    // Simulator builds are unsigned — skip all ASC/signing/ExportOptions work.
    let signingInfo = null;
    if (!isSimulator) {
      // Resolve ASC credentials locally (keychain > env > config) and authenticate on remote
      const ascCreds = resolveAscCredentials(config);
      logger.debug(`ASC credentials source: ${ascCreds.source}`);
      await authenticateAsc(ssh, ascCreds);

      // Fetch + install signing assets on remote
      signingInfo = await setupSigning(ssh, {
        bundleId: config.signing?.bundleId || profile.bundleId,
        profileType: profile.profileType || config.signing?.profileType,
        distribution,
        syncRepo: config.signing?.syncRepo,
        p12Password: config.signing?.p12Password,
        createMissing: config.signing?.createMissing !== false,
      });
    } else {
      logger.info('Simulator build — skipping signing (unsigned iphonesimulator build).');
    }

    // Clone repo
    const workDir = await cloneRepo(ssh, config.repo.url, config.repo.branch, cloneWorkDir);

    if (!isSimulator) {
      // Generate ExportOptions.plist on remote using real signing values
      const method = distribution === 'ad-hoc' ? 'ad-hoc' : 'app-store';
      const plistContent = generateExportOptionsPlist({
        method,
        teamId: signingInfo.teamId,
        bundleId: signingInfo.bundleId,
        profileName: signingInfo.profileName,
        profileUuid: signingInfo.profileUuid,
      });
      await sshExec(ssh, `cat > ${workDir}/ExportOptions.plist << 'PLIST_EOF'\n${plistContent}\nPLIST_EOF`);

      // Make build keychain available to xcodebuild (it inherits PATH/env from the tmux shell)
      profile.env = {
        ...(profile.env || {}),
        OTHER_CODE_SIGN_FLAGS: `--keychain ${signingInfo.keychain}`,
      };
    }

    // Step 4: Build
    logger.step(4, 7, 'Building app');
    const buildSteps = profile.buildType === 'expo'
      ? getExpoBuildSteps({ scheme: profile.scheme, buildConfiguration: profile.buildConfiguration, workDir, distribution })
      : getClassicBuildSteps({ scheme: profile.scheme, buildConfiguration: profile.buildConfiguration, workDir, distribution });

    // Build env vars as export string for shell persistence
    const envExports = Object.entries(profile.env || {})
      .map(([k, v]) => `export ${k}="${v}"`)
      .join(' && ');

    const buildScript = buildSteps.map(s => `echo "=== ${s.name} ===" && ${s.cmd}`).join(' && ');
    const fullScript = envExports ? `${envExports} && ${buildScript}` : buildScript;

    const timeoutPromise = new Promise((_, reject) => {
      const remaining = totalTimeoutMs - (Date.now() - buildStartTime);
      setTimeout(() => reject(new Error(`Build timed out after ${options.timeout || 60} minutes`)), remaining);
    });

    let runPromise;
    if (hostCaps.tmux) {
      // Run inside tmux for resilience (survives a dropped SSH connection).
      await sshExec(ssh, `tmux kill-session -t ${TMUX_SESSION} 2>/dev/null || true`);
      await sshExec(ssh, `tmux new-session -d -s ${TMUX_SESSION} 'bash -c "${fullScript.replace(/"/g, '\\"')}" 2>&1 | tee ${TMUX_LOG}'`);
      logger.info('Build started in tmux session. Streaming logs...');
      runPromise = sshExec(ssh, `tail -f ${TMUX_LOG} &
        while tmux has-session -t ${TMUX_SESSION} 2>/dev/null; do sleep 5; done
        kill %1 2>/dev/null
        tail -1 ${TMUX_LOG}`, { stream: true });
    } else {
      // No tmux (some managed hosts): run the script directly, streaming output.
      logger.info('tmux unavailable — running build directly (no reconnect/--resume).');
      runPromise = sshExec(ssh, fullScript, { stream: true });
    }

    await Promise.race([runPromise, timeoutPromise]);

    // Step 5: Retrieve artifact
    logger.step(5, 7, 'Retrieving build artifact');
    let localPath, remotePath;
    if (isSimulator) {
      const tarball = getSimulatorTarballPath(workDir, profile.scheme);
      ({ localPath, remotePath } = await downloadSimulatorTarball(
        ssh, tarball, process.cwd(), profile.scheme
      ));
    } else {
      const exportPath = `${workDir}/build/export`;
      ({ localPath, remotePath } = await findAndDownloadIpa(
        ssh, exportPath, process.cwd(), profile.scheme
      ));
    }

    // Step 6: Distribute (upload + QR install) — skipped without config or for app-store
    logger.step(6, 7, 'Distributing build');
    try {
      const commit = (await sshExec(ssh, `cd ${workDir} && git rev-parse --short HEAD`)).stdout.trim();
      await distributeBuild({
        ssh,
        config,
        profile,
        profileName,
        remoteIpaPath: remotePath,
        signingInfo,
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
    } catch (err) {
      logger.warn(`Distribute step failed: ${err.message}`);
      logger.warn('Artifact is still available locally; continuing.');
    }

    // Step 7: Submit (if auto-submit) — not applicable to simulator builds
    if (options.autoSubmit && isSimulator) {
      logger.warn('--auto-submit ignored for simulator builds (nothing to submit to TestFlight).');
      logger.step(7, 7, 'Build complete');
      logger.success(`Simulator app saved to: ${localPath}`);
    } else if (options.autoSubmit) {
      logger.step(7, 7, 'Submitting to TestFlight');
      await submitToTestFlight(ssh, {
        ipaPath: remotePath,
        config,
        profileName,
        whatToTest: options.message, // --message flag used as "What to Test"
      });
    } else {
      logger.step(7, 7, 'Build complete');
      logger.success(`${isSimulator ? 'Simulator app' : 'IPA'} saved to: ${localPath}`);
    }

    // Offer AMI caching after first build with no custom AMI (AWS only)
    if (!isManaged && !config.aws.customAmiId && !options.nonInteractive) {
      const saveAmi = await confirm('Save this instance as a custom AMI for faster future builds?', true);
      if (saveAmi) {
        const amiId = await createCustomAmi(state.instanceId, config.aws.region);
        logger.info(`Add this to your deploy.config.json aws section: "customAmiId": "${amiId}"`);
      }
    }
  } finally {
    // Best-effort cleanup of remote signing state and asc creds
    try { await teardownSigning(ssh); } catch { /* ignore */ }
    try { await cleanupAscCredentials(ssh); } catch { /* ignore */ }
    ssh.dispose();
  }

  // Teardown unless --no-teardown. Managed hosts are never torn down — we don't
  // own the machine's lifecycle, so just drop the connection.
  if (isManaged) {
    logger.info(
      hostKind === 'cua'
        ? 'cua sandbox left running (rn-deploy does not stop it — manage its lifecycle via the cua CLI/dashboard).'
        : 'Managed host left running (not owned by rn-deploy).'
    );
  } else if (!options.noTeardown) {
    await infraDown(options);
  } else {
    logger.info('Instance kept alive (--no-teardown). Run "rn-deploy infra down" when done.');
  }
}

async function runViaGithubActions(config, profile, profileName, options) {
  const { triggerGithubActionsBuild } = await import('../remote/github-actions.js');
  await triggerGithubActionsBuild({
    host: config.host,
    profile: profileName,
    message: options.message,
  });

  // Surface the build the runner just published via the registry.
  if (config.storage) {
    try {
      const { createStorageAdapter } = await import('../storage/index.js');
      const { deriveSlug, readIndex } = await import('../distribute/registry.js');
      const storage = createStorageAdapter(config.storage);
      const builds = await readIndex(storage, deriveSlug(config, profile));
      if (builds[0]) {
        logger.success('Latest build from this run:');
        logger.info(`  Install page : ${builds[0].installPageUrl}`);
        logger.info(`  Artifact     : ${builds[0].artifactUrl}`);
      }
    } catch (err) {
      logger.warn(`Could not read build registry: ${err.message}`);
    }
  }
}

async function resumeBuild(_options) {
  const state = loadState();
  if (!state) {
    throw new Error('No active instance found. Cannot resume.');
  }

  const config = loadConfig();
  const keyPath = state.keyPath || getPrivateKeyPath(config.aws.keyPairName);
  const ssh = await createSshConnection(state.publicIp, keyPath);

  try {
    // Check if tmux session exists
    const check = await sshExec(ssh, `tmux has-session -t ${TMUX_SESSION} 2>/dev/null && echo "running" || echo "done"`);
    if (check.stdout.trim() === 'running') {
      logger.info('Reconnecting to active build session...');
      await sshExec(ssh, `tail -f ${TMUX_LOG} &
        while tmux has-session -t ${TMUX_SESSION} 2>/dev/null; do sleep 5; done
        kill %1 2>/dev/null`, { stream: true });
    } else {
      logger.info('Build session completed. Checking for artifacts...');
      await sshExec(ssh, `cat ${TMUX_LOG}`, { stream: true });
    }
  } finally {
    ssh.dispose();
  }
}

async function isInstanceReachable(state) {
  if (!state || !state.keyPath) return false;
  try {
    // Note: StrictHostKeyChecking=accept-new is acceptable here because EC2 Mac instances
    // are ephemeral — host keys change on every new instance. We verify identity
    // via AWS instance ID + the SSH key pair we created.
    const { execFileSync } = await import('node:child_process');
    execFileSync('ssh', [
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-i', state.keyPath,
      `ec2-user@${state.publicIp}`,
      'echo ok',
    ], { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}
