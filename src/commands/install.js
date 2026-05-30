import qrcode from 'qrcode-terminal';
import { fetchBuilds, printBuildsTable } from './builds.js';
import { createSshConnection, sshExec, sshOptsFromHost } from '../remote/ssh.js';
import { loadState } from '../infra/state.js';
import { getPrivateKeyPath } from '../infra/key-pair.js';
import { select } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

// Choose a build from the registry given selector options. Pure + testable.
// Precedence: --id > --version (latest match) > --latest. Returns null when
// nothing matches or no selector was given (caller may then prompt).
export function selectBuild(builds, { id, version, latest } = {}) {
  if (builds.length === 0) return null;
  if (id) return builds.find(b => b.id === id || b.id?.startsWith(id)) || null;
  if (version) {
    // builds are newest-first, so the first match is the latest of that version
    return builds.find(b => b.version === version) || null;
  }
  if (latest) return builds[0];
  return null;
}

// Shell script (run on the build host) that downloads a simulator .app tarball
// from its public URL and installs+launches it on the booted simulator.
export function buildSimulatorInstallScript({ artifactUrl, bundleId, installDir = '~/rn-deploy-install' }) {
  const steps = [
    `rm -rf ${installDir} && mkdir -p ${installDir} && cd ${installDir}`,
    `curl -fL "${artifactUrl}" -o app.tgz`,
    `tar -xzf app.tgz`,
    `APP=$(ls -d *.app | head -1)`,
    `if [ -z "$APP" ]; then echo "no .app found in tarball" >&2; exit 1; fi`,
    `xcrun simctl install booted "$APP"`,
  ];
  if (bundleId) steps.push(`xcrun simctl launch booted "${bundleId}"`);
  return steps.join(' && ');
}

export async function installCommand(options = {}) {
  const { config, builds } = await fetchBuilds({ all: options.all });

  if (builds.length === 0) {
    logger.info('No builds found in the registry. Run a build first.');
    return;
  }

  let build = selectBuild(builds, options);

  if (!build) {
    if (options.nonInteractive) {
      throw new Error('No build matched. Pass --id, --version, or --latest in non-interactive mode.');
    }
    printBuildsTable(builds);
    const choice = await select(
      'Which build do you want to install?',
      builds.map((b, i) => ({
        name: `${b.version || '—'} (${b.buildNumber || '—'}) · ${b.profile} · ${b.distribution} · ${b.id.slice(0, 8)}`,
        value: i,
      }))
    );
    build = builds[choice];
  }

  logger.info(`Selected build ${build.id.slice(0, 8)} — ${build.version} (${build.buildNumber}), ${build.distribution}`);

  // IPA builds can't be installed on a simulator; surface the device install page.
  if (build.artifactKind !== 'simulator-app') {
    logger.info('This is a device build (.ipa). Install it on a device via the install page:');
    logger.info(`  ${build.installPageUrl}`);
    if (build.installPageUrl) {
      qrcode.generate(build.installPageUrl, { small: true }, (qr) => process.stdout.write('\n' + qr + '\n'));
    }
    return;
  }

  // Simulator build — connect to the configured host and install on its sim.
  const hostKind = config.host?.kind || 'aws';
  let ssh;
  if (hostKind === 'macincloud') {
    ssh = await createSshConnection(sshOptsFromHost(config.host));
  } else {
    const state = loadState();
    if (!state) {
      throw new Error('No running instance found. Bring one up with "rn-deploy infra up" (or use a macincloud host).');
    }
    const keyPath = state.keyPath || getPrivateKeyPath(config.aws.keyPairName);
    ssh = await createSshConnection(state.publicIp, keyPath);
  }

  try {
    const installDir = config.host?.workDir
      ? `${config.host.workDir}-install`
      : '~/rn-deploy-install';
    const script = buildSimulatorInstallScript({
      artifactUrl: build.artifactUrl,
      bundleId: build.bundleId,
      installDir,
    });
    logger.info('Installing on the booted simulator (a simulator must be running — e.g. via baguette)...');
    await sshExec(ssh, script, { stream: true });
    logger.success('Installed and launched on the simulator.');
  } finally {
    ssh.dispose();
  }
}
