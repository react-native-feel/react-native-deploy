import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

// We pin a known-good release rather than tracking "latest" — gives reproducible installs
// and keeps us from getting surprised by a CLI breaking change. Bump as needed.
const BAGUETTE_VERSION = 'v0.1.3';
const BAGUETTE_TARBALL = `baguette_${BAGUETTE_VERSION}_macOS_arm64.tar.gz`;
const BAGUETTE_URL = `https://github.com/tddworks/baguette/releases/download/${BAGUETTE_VERSION}/${BAGUETTE_TARBALL}`;
// Inside the tarball: baguette-v0.1.3-macOS-arm64/{Baguette, Baguette_Baguette.bundle/}
const BAGUETTE_INSTALL_DIR = `$HOME/.baguette/${BAGUETTE_VERSION}`;
const BAGUETTE_SUBDIR = `baguette-${BAGUETTE_VERSION}-macOS-arm64`;
const BAGUETTE_BIN = `${BAGUETTE_INSTALL_DIR}/${BAGUETTE_SUBDIR}/Baguette`;

export async function preflightBaguette(ssh) {
  logger.step(1, 5, 'Checking remote Mac prerequisites...');

  const { stdout: arch } = await sshExec(ssh, 'uname -m');
  if (arch.trim() !== 'arm64') {
    throw new Error(`baguette requires Apple Silicon (arm64), but remote is ${arch.trim()}`);
  }

  const { stdout: osVer } = await sshExec(ssh, 'sw_vers -productVersion');
  const major = parseInt(osVer.trim().split('.')[0], 10);
  if (Number.isFinite(major) && major < 15) {
    throw new Error(`baguette requires macOS 15+, found ${osVer.trim()}`);
  }

  await sshExec(ssh, 'command -v xcrun >/dev/null').catch(() => {
    throw new Error('Xcode command-line tools not found on remote Mac.');
  });

  await sshExec(ssh, 'command -v curl >/dev/null').catch(() => {
    throw new Error('curl not found on remote Mac.');
  });

  logger.success(`Prereqs OK (${arch.trim()}, macOS ${osVer.trim()})`);
}

export async function installBaguette(ssh) {
  logger.step(2, 5, `Installing baguette ${BAGUETTE_VERSION}...`);

  const installed = await sshExec(ssh, `test -x ${BAGUETTE_BIN}`).then(() => true).catch(() => false);
  if (installed) {
    logger.success(`baguette already installed at ${BAGUETTE_BIN}`);
    return;
  }

  await sshExec(ssh, `mkdir -p ${BAGUETTE_INSTALL_DIR}`);
  // -fL: fail on HTTP errors, follow redirects. Output to a tmp file so a partial download doesn't leave a half-tarball.
  await sshExec(
    ssh,
    `curl -fL --retry 3 -o ${BAGUETTE_INSTALL_DIR}/${BAGUETTE_TARBALL} ${BAGUETTE_URL}`,
    { stream: true },
  );
  await sshExec(ssh, `tar -xzf ${BAGUETTE_INSTALL_DIR}/${BAGUETTE_TARBALL} -C ${BAGUETTE_INSTALL_DIR}`);
  await sshExec(ssh, `chmod +x ${BAGUETTE_BIN}`);
  await sshExec(ssh, `rm -f ${BAGUETTE_INSTALL_DIR}/${BAGUETTE_TARBALL}`);

  logger.success(`baguette installed at ${BAGUETTE_BIN}`);
}

export async function resolveDeviceUdid(ssh, deviceName, runtime) {
  logger.step(3, 5, `Resolving simulator "${deviceName}"...`);

  const { stdout } = await sshExec(ssh, 'xcrun simctl list devices --json');
  const devices = JSON.parse(stdout).devices;

  for (const runtimeId of Object.keys(devices)) {
    if (!runtimeId.includes('iOS')) continue;
    const match = devices[runtimeId].find((d) => d.name === deviceName && d.isAvailable);
    if (match) {
      logger.success(`Found device "${deviceName}" (${match.udid})`);
      return match.udid;
    }
  }

  // Not found — create it.
  let runtimeId = runtime;
  if (!runtimeId) {
    const { stdout: rtOut } = await sshExec(ssh, 'xcrun simctl list runtimes --json');
    const iosRuntimes = JSON.parse(rtOut).runtimes.filter((r) => r.platform === 'iOS' && r.isAvailable);
    if (iosRuntimes.length === 0) throw new Error('No iOS runtimes available on remote Mac');
    runtimeId = iosRuntimes[iosRuntimes.length - 1].identifier;
  }

  logger.info(`Creating simulator "${deviceName}" with runtime ${runtimeId}...`);
  const { stdout: createOut } = await sshExec(ssh, `xcrun simctl create "${deviceName}" "${deviceName}" "${runtimeId}"`);
  const udid = createOut.trim();
  logger.success(`Created device "${deviceName}" (${udid})`);
  return udid;
}

export async function bootViaBaguette(ssh, udid) {
  logger.step(4, 5, `Booting simulator via baguette (${udid})...`);

  // Not using stream:true — sshExec drops stdout/stderr from the error message in stream mode,
  // and we need to inspect the output to detect "already booted" (a non-zero exit we want to swallow).
  try {
    await sshExec(ssh, `${BAGUETTE_BIN} boot --udid ${udid}`);
  } catch (err) {
    if (/current state:\s*Booted|already.*boot/i.test(err.message)) {
      logger.debug('Simulator already booted — continuing');
    } else {
      throw err;
    }
  }
  logger.success('Simulator booted');
}

export async function startBaguetteServer(ssh, port = 8421) {
  logger.step(5, 5, `Starting baguette server on 127.0.0.1:${port}...`);

  // Kill any prior baguette server bound to this port, then start detached.
  // Managed plans don't allow LaunchAgent registration, so use nohup like the websockify path.
  await sshExec(ssh, `pkill -f 'Baguette serve.*--port ${port}' 2>/dev/null; true`);
  await sshExec(
    ssh,
    `nohup ${BAGUETTE_BIN} serve --host 127.0.0.1 --port ${port} </dev/null >/tmp/baguette.log 2>&1 &`,
  );
  logger.success(`baguette serve started on port ${port}`);
}

export async function waitForBaguette(ssh, port = 8421, maxAttempts = 30) {
  logger.startSpinner('Waiting for baguette server...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await sshExec(ssh, `nc -z localhost ${port}`);
      logger.stopSpinner(true, `baguette ready on port ${port}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  logger.stopSpinner(false, 'baguette not responding');
  const { stdout: log } = await sshExec(ssh, 'tail -n 40 /tmp/baguette.log 2>/dev/null || true').catch(() => ({ stdout: '' }));
  throw new Error(`baguette did not start on port ${port}\n${log}`);
}
