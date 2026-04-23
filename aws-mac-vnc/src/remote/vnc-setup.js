import { randomBytes } from 'node:crypto';
import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

export function generateVncPassword() {
  return randomBytes(4).toString('hex'); // 8-char hex string
}

export async function setupVnc(ssh, password, { skipSudo = false } = {}) {
  logger.step(1, 4, 'Enabling macOS Screen Sharing (VNC)...');

  if (skipSudo) {
    // Managed plans (e.g. MacinCloud Pay-As-You-Go) have Screen Sharing
    // already enabled and don't grant sudo. Trust the provided VNC password.
    logger.success('VNC setup skipped (using provider-configured Screen Sharing)');
    return;
  }

  await sshExec(ssh, [
    'sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart',
    '-activate -configure -access -on -privs -all',
    '-restart -agent -menu',
  ].join(' '));

  await sshExec(ssh, [
    'sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart',
    `-configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw ${password}`,
  ].join(' '));

  await sshExec(ssh, 'sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist').catch(() => {
    logger.debug('screensharing plist may already be loaded');
  });

  logger.success('VNC enabled');
}

export async function setupWebsockify(ssh, port = 6080) {
  logger.step(2, 4, 'Installing and starting websockify...');

  // Install to user site-packages so no sudo is needed on managed plans.
  // Newer pythons enforce PEP 668; fall back to --break-system-packages if plain --user refuses.
  await sshExec(ssh, 'pip3 install --user websockify || pip3 install --user --break-system-packages websockify');

  const { stdout: python3Path } = await sshExec(ssh, 'which python3');
  const pythonFullPath = python3Path.trim() || '/usr/bin/python3';

  // Kill any prior instance on this port, then start detached.
  // Managed plans (MacinCloud) restrict user LaunchAgent registration, so skip launchd and use nohup.
  // The process stays alive for the duration of the SSH tunnel — that's all we need for the streaming session.
  await sshExec(ssh, `pkill -f 'websockify .*${port}' 2>/dev/null; true`);
  await sshExec(
    ssh,
    `nohup ${pythonFullPath} -m websockify ${port} localhost:5900 </dev/null >/tmp/websockify.log 2>&1 &`,
  );

  logger.success(`websockify started on port ${port}`);
}

export async function bootSimulator(ssh, device = 'iPhone 16 Pro', runtime) {
  logger.step(3, 4, `Booting Simulator: ${device}...`);

  // List available runtimes if none specified
  if (!runtime) {
    const { stdout } = await sshExec(ssh, 'xcrun simctl list runtimes --json');
    const runtimes = JSON.parse(stdout).runtimes.filter((r) => r.platform === 'iOS' && r.isAvailable);
    if (runtimes.length === 0) throw new Error('No iOS runtimes available');
    runtime = runtimes[runtimes.length - 1].identifier;
    logger.debug(`Using runtime: ${runtime}`);
  }

  // Boot existing, create-then-boot if it doesn't exist, accept already-booted as success.
  try {
    await sshExec(ssh, `xcrun simctl boot "${device}"`);
  } catch (err) {
    const msg = err.message || '';
    if (/current state:\s*Booted/i.test(msg)) {
      logger.debug('Simulator already booted');
    } else if (/Invalid device|Unable to lookup|No devices are booted|no such/i.test(msg)) {
      logger.debug('Device does not exist, creating...');
      await sshExec(ssh, `xcrun simctl create "${device}" "${device}" ${runtime}`);
      await sshExec(ssh, `xcrun simctl boot "${device}"`);
    } else {
      throw err;
    }
  }

  // Try to launch Simulator.app in the user's Aqua session. This only works if we're already
  // in the GUI launchd domain — on managed plans (MacinCloud) without sudo we can't switch
  // domains from SSH, so if no GUI session is active this will fail. That's OK: the simulator
  // is already booted (headless), and you can launch Simulator.app by hand inside RDP.
  const launched = await sshExec(ssh, 'open -a Simulator')
    .then(() => true)
    .catch((err) => {
      logger.debug(`open -a Simulator failed: ${err.message}`);
      return false;
    });

  if (launched) {
    // Fullscreen + hide chrome — best-effort, needs the GUI session too
    await sshExec(ssh, [
      'osascript',
      '-e \'tell application "Simulator" to activate\'',
      '-e \'delay 3\'',
      '-e \'tell application "System Events" to keystroke "f" using {command down, control down}\'',
    ].join(' ')).catch((err) => {
      logger.debug(`Fullscreen osascript failed (non-fatal): ${err.message}`);
    });
    logger.success(`Simulator "${device}" booted and fullscreened`);
  } else {
    logger.warn(
      `Simulator booted headlessly, but Simulator.app could not be launched from SSH ` +
      `(no accessible GUI session). RDP into the Mac (MacinCloud_Full_Screen.rdp) and ` +
      `launch Simulator.app from the Dock — device "${device}" is already booted.`,
    );
  }
}

export async function hideDesktopChrome(ssh) {
  logger.step(4, 4, 'Hiding desktop chrome...');

  // `defaults write` works from SSH — no GUI context needed — but `killall Dock` only restarts
  // the Dock if it's running in the user's GUI session, so treat failures as non-fatal.
  await sshExec(ssh, 'defaults write com.apple.dock autohide -bool true').catch(() => {});
  await sshExec(ssh, 'defaults write com.apple.dock autohide-delay -float 999').catch(() => {});
  await sshExec(ssh, 'launchctl asuser $(id -u) killall Dock').catch(() => {});
  await sshExec(ssh, 'defaults write NSGlobalDomain _HIHideMenuBar -bool true').catch(() => {});

  logger.success('Desktop chrome hidden');
}

export async function waitForWebsockify(ssh, port = 6080, maxAttempts = 30) {
  const spinner = logger.startSpinner('Waiting for websockify to be ready...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await sshExec(ssh, `nc -z localhost ${port}`);
      logger.stopSpinner(true, `websockify ready on port ${port}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  logger.stopSpinner(false, 'websockify not responding');
  throw new Error(`websockify did not start on port ${port}`);
}
