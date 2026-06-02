import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

// Baguette + cloudflared "live preview" helpers, written against the ssh-like
// interface so they run over either transport (macincloud SSH or a cua cloud
// sandbox). The flow: install baguette + cloudflared on the host, boot an iOS
// simulator, install + launch a simulator build, serve it through baguette on
// 127.0.0.1, then expose that port with a cloudflared quick tunnel and return
// the public *.trycloudflare.com URL.
//
// Version pin matches aws-mac-vnc/src/remote/baguette-setup.js — bump together.
const BAGUETTE_VERSION = 'v0.1.3';
const BAGUETTE_SUBDIR = `baguette-${BAGUETTE_VERSION}-macOS-arm64`;
const BAGUETTE_BIN = `$HOME/.baguette/${BAGUETTE_VERSION}/${BAGUETTE_SUBDIR}/Baguette`;
const BAGUETTE_TARBALL = `baguette_${BAGUETTE_VERSION}_macOS_arm64.tar.gz`;
const CF_BIN = '$HOME/.local/bin/cloudflared';

export const DEFAULT_BAGUETTE_PORT = 8421;

// Standalone-binary installs (no brew/sudo): managed plans and cua sandboxes
// can't register LaunchAgents or `brew install`, so we fetch release binaries
// into $HOME and run them with nohup.
export async function ensureBaguette(ssh) {
  const installed = await sshExec(ssh, `test -x ${BAGUETTE_BIN} && echo yes || echo no`);
  if (installed.stdout.trim() === 'yes') {
    logger.debug('baguette already installed');
    return BAGUETTE_BIN;
  }
  logger.info(`Installing baguette ${BAGUETTE_VERSION}...`);
  const url = `https://github.com/tddworks/baguette/releases/download/${BAGUETTE_VERSION}/${BAGUETTE_TARBALL}`;
  await sshExec(
    ssh,
    `mkdir -p $HOME/.baguette/${BAGUETTE_VERSION} && ` +
    `curl -fL --retry 3 -o /tmp/${BAGUETTE_TARBALL} ${url} && ` +
    `tar -xzf /tmp/${BAGUETTE_TARBALL} -C $HOME/.baguette/${BAGUETTE_VERSION} && ` +
    `chmod +x ${BAGUETTE_BIN} && rm -f /tmp/${BAGUETTE_TARBALL}`,
    { stream: true },
  );
  return BAGUETTE_BIN;
}

export async function ensureCloudflared(ssh) {
  const installed = await sshExec(ssh, `test -x ${CF_BIN} && echo yes || echo no`);
  if (installed.stdout.trim() === 'yes') {
    logger.debug('cloudflared already installed');
    return CF_BIN;
  }
  logger.info('Installing cloudflared...');
  await sshExec(
    ssh,
    `mkdir -p $HOME/.local/bin && ` +
    `curl -fL --retry 3 -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz && ` +
    `tar -xzf /tmp/cf.tgz -C $HOME/.local/bin && chmod +x ${CF_BIN} && rm -f /tmp/cf.tgz`,
    { stream: true },
  );
  return CF_BIN;
}

// Pick a booted iPhone simulator, else the first available one, and boot it.
export async function bootSimulator(ssh) {
  const devices = JSON.parse((await sshExec(ssh, 'xcrun simctl list devices --json')).stdout).devices;
  let udid = null;
  for (const rt of Object.keys(devices)) {
    if (!rt.includes('iOS')) continue;
    const booted = devices[rt].find((d) => d.state === 'Booted');
    if (booted) { udid = booted.udid; break; }
  }
  if (!udid) {
    for (const rt of Object.keys(devices)) {
      if (!rt.includes('iOS')) continue;
      const avail = devices[rt].find((d) => d.isAvailable && /iPhone/.test(d.name));
      if (avail) { udid = avail.udid; break; }
    }
  }
  if (!udid) throw new Error('no iPhone simulator available on the host');
  await sshExec(ssh, `xcrun simctl bootstatus ${udid} -b || xcrun simctl boot ${udid} || true`);
  return udid;
}

// Download a simulator .app tarball from a URL, install it, and launch it.
// Returns the app's real bundle id (read from Info.plist).
export async function installSimulatorApp(ssh, udid, artifactUrl) {
  await sshExec(
    ssh,
    `rm -rf ~/rnd-preview && mkdir -p ~/rnd-preview && cd ~/rnd-preview && ` +
    `curl -fL "${artifactUrl}" -o app.tgz && tar -xzf app.tgz && ` +
    `APP=$(ls -d *.app | head -1) && xcrun simctl install ${udid} "$APP"`,
    { stream: true },
  );
  const bundleId = (await sshExec(
    ssh,
    `cd ~/rnd-preview && APP=$(ls -d *.app | head -1) && /usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist"`,
  )).stdout.trim();
  await sshExec(ssh, `xcrun simctl launch ${udid} ${bundleId} || true`);
  return bundleId;
}

// Start baguette serving on 127.0.0.1:port (detached), then a cloudflared quick
// tunnel pointing at it. Polls the cloudflared log for the public URL.
export async function startTunnel(ssh, baguetteBin, cfBin, port = DEFAULT_BAGUETTE_PORT) {
  await sshExec(
    ssh,
    `pkill -f 'Baguette serve.*--port ${port}' 2>/dev/null; ` +
    `nohup ${baguetteBin} serve --host 127.0.0.1 --port ${port} </dev/null >/tmp/baguette.log 2>&1 & sleep 3; true`,
  );
  await sshExec(
    ssh,
    `pkill -f 'cloudflared tunnel --url' 2>/dev/null; ` +
    `nohup ${cfBin} tunnel --url http://localhost:${port} </dev/null >/tmp/cloudflared.log 2>&1 & sleep 1; true`,
  );

  let url = null;
  for (let i = 0; i < 40; i++) {
    url = (await sshExec(
      ssh,
      "grep -Eo 'https://[a-z0-9-]+\\.trycloudflare\\.com' /tmp/cloudflared.log | head -1 || true",
    )).stdout.trim();
    if (url) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!url) {
    const log = (await sshExec(ssh, 'tail -n 25 /tmp/cloudflared.log 2>/dev/null || true')).stdout;
    throw new Error(`cloudflared did not produce a tunnel URL\n${log}`);
  }
  return url;
}
