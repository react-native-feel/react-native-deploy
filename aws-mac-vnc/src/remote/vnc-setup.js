import { randomBytes } from 'node:crypto';
import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

export function generateVncPassword() {
  return randomBytes(4).toString('hex'); // 8-char hex string
}

export async function setupVnc(ssh, password) {
  logger.step(1, 4, 'Enabling macOS Screen Sharing (VNC)...');

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

  await sshExec(ssh, 'pip3 install websockify');

  // Determine full path for launchd (which doesn't inherit PATH)
  const { stdout: websockifyPath } = await sshExec(ssh, 'which websockify');
  const fullPath = websockifyPath.trim() || '/usr/local/bin/websockify';

  // Create launchd plist for persistence (survives SSH disconnect)
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.websockify</string>
  <key>ProgramArguments</key><array>
    <string>${fullPath}</string>
    <string>${port}</string>
    <string>localhost:5900</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/websockify.log</string>
  <key>StandardErrorPath</key><string>/tmp/websockify.err</string>
</dict></plist>`;

  await sshExec(ssh, 'mkdir -p ~/Library/LaunchAgents');
  await sshExec(ssh, `cat > ~/Library/LaunchAgents/com.websockify.plist << 'PLIST'\n${plist}\nPLIST`);
  await sshExec(ssh, 'launchctl load ~/Library/LaunchAgents/com.websockify.plist');

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

  // Create device if needed, or boot existing
  try {
    await sshExec(ssh, `xcrun simctl boot "${device}"`);
  } catch {
    logger.debug('Device may not exist, creating...');
    await sshExec(ssh, `xcrun simctl create "${device}" "${device}" ${runtime}`);
    await sshExec(ssh, `xcrun simctl boot "${device}"`);
  }

  await sshExec(ssh, 'open -a Simulator');

  // Fullscreen + hide chrome
  await sshExec(ssh, [
    'osascript',
    '-e \'tell application "Simulator" to activate\'',
    '-e \'delay 3\'',
    '-e \'tell application "System Events" to keystroke "f" using {command down, control down}\'',
  ].join(' '));

  logger.success(`Simulator "${device}" booted and fullscreened`);
}

export async function hideDesktopChrome(ssh) {
  logger.step(4, 4, 'Hiding desktop chrome...');

  await sshExec(ssh, 'defaults write com.apple.dock autohide -bool true');
  await sshExec(ssh, 'defaults write com.apple.dock autohide-delay -float 999');
  await sshExec(ssh, 'killall Dock').catch(() => {});
  await sshExec(ssh, 'defaults write NSGlobalDomain _HIHideMenuBar -bool true');

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
