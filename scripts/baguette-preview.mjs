#!/usr/bin/env node
// Preview the latest published simulator build on a baguette session and expose
// it through a cloudflared quick tunnel (public https URL).
//
// Reads deploy.config.json from the current directory for the macincloud host
// + R2 storage, finds the newest simulator build in the registry, then on the
// host: boots a simulator, downloads + installs + launches the .app, starts
// baguette, and opens a cloudflared tunnel. Prints the public URL.
//
// Usage (creds in env — `source .e2e/load-env.sh`):
//   node <repo>/scripts/baguette-preview.mjs            # uses app.slug from config
//   node <repo>/scripts/baguette-preview.mjs --slug myapp
//   PORT=8421 node .../baguette-preview.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RND = join(dirname(fileURLToPath(import.meta.url)), '..');
const { loadConfig } = await import(join(RND, 'src/config/loader.js'));
const { createStorageAdapter } = await import(join(RND, 'src/storage/index.js'));
const { deriveSlug, readIndex } = await import(join(RND, 'src/distribute/registry.js'));
const { createSshConnection, sshOptsFromHost, detectShellEnvPrefix, withCommandPrefix, sshExec } =
  await import(join(RND, 'src/remote/ssh.js'));

const argSlug = process.argv.includes('--slug')
  ? process.argv[process.argv.indexOf('--slug') + 1]
  : null;
const PORT = Number(process.env.PORT || 8421);
const CF_BIN = '$HOME/.local/bin/cloudflared';

const config = loadConfig(process.cwd());
if (config.host?.kind !== 'macincloud') {
  throw new Error(`baguette-preview needs host.kind=macincloud (got ${config.host?.kind})`);
}
if (!config.storage) throw new Error('deploy.config.json needs a storage block');

const slug = argSlug || deriveSlug(config);
const storage = createStorageAdapter(config.storage);
const builds = await readIndex(storage, slug);
const latest = builds.find((b) => b.artifactKind === 'simulator-app');
if (!latest) throw new Error(`no simulator build found in registry for slug "${slug}"`);
console.log(`Latest build for ${slug}: ${latest.id.slice(0, 8)} (${latest.version || '—'})`);
console.log(`Artifact: ${latest.artifactUrl}`);

let ssh = await createSshConnection(sshOptsFromHost(config.host));
ssh = withCommandPrefix(ssh, await detectShellEnvPrefix(ssh));
const run = async (label, cmd, stream = false) => {
  process.stdout.write(`\n# ${label}\n`);
  const r = await sshExec(ssh, cmd, { stream });
  if (!stream && r.stdout.trim()) console.log(r.stdout.trim());
  return r;
};

try {
  // baguette must be installed (the aws-mac-vnc `baguette` command installs it,
  // or it persists from a prior run). Pin matches aws-mac-vnc/baguette-setup.js.
  const VER = 'v0.1.3';
  const BAG = `$HOME/.baguette/${VER}/baguette-${VER}-macOS-arm64/Baguette`;
  const hasBag = await sshExec(ssh, `test -x ${BAG} && echo yes || echo no`);
  if (hasBag.stdout.trim() !== 'yes') {
    const TAR = `baguette_${VER}_macOS_arm64.tar.gz`;
    await run('install baguette', `mkdir -p $HOME/.baguette/${VER} && curl -fL --retry 3 -o /tmp/${TAR} https://github.com/tddworks/baguette/releases/download/${VER}/${TAR} && tar -xzf /tmp/${TAR} -C $HOME/.baguette/${VER} && chmod +x ${BAG}`, true);
  }

  // Pick a booted iPhone sim, else the first available, and boot it.
  const devices = JSON.parse((await sshExec(ssh, 'xcrun simctl list devices --json')).stdout).devices;
  let udid = null;
  for (const rt of Object.keys(devices)) {
    if (rt.includes('iOS')) { const b = devices[rt].find((d) => d.state === 'Booted'); if (b) { udid = b.udid; break; } }
  }
  if (!udid) {
    for (const rt of Object.keys(devices)) {
      if (rt.includes('iOS')) { const d = devices[rt].find((x) => x.isAvailable && /iPhone/.test(x.name)); if (d) { udid = d.udid; break; } }
    }
  }
  if (!udid) throw new Error('no iPhone simulator available on the host');
  console.log(`\nSimulator: ${udid}`);
  await run('boot simulator', `xcrun simctl bootstatus ${udid} -b || xcrun simctl boot ${udid} || true`);

  // Download + install the .app; read its real bundle id from Info.plist so we
  // can launch it without relying on config.
  await run('download + install app', `rm -rf ~/rnd-preview && mkdir -p ~/rnd-preview && cd ~/rnd-preview && curl -fL "${latest.artifactUrl}" -o app.tgz && tar -xzf app.tgz && APP=$(ls -d *.app | head -1) && echo "app=$APP" && xcrun simctl install ${udid} "$APP"`, true);
  const bundleId = (await sshExec(ssh, `cd ~/rnd-preview && APP=$(ls -d *.app | head -1) && /usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist"`)).stdout.trim();
  console.log(`Bundle id: ${bundleId}`);
  await run('launch app', `xcrun simctl launch ${udid} ${bundleId} || true`);

  // baguette serve (detached).
  await run('start baguette', `pkill -f 'Baguette serve.*--port ${PORT}' 2>/dev/null; nohup ${BAG} serve --host 127.0.0.1 --port ${PORT} </dev/null >/tmp/baguette.log 2>&1 & sleep 3; curl -s -o /dev/null -w "baguette HTTP %{http_code}\\n" http://localhost:${PORT}/simulators`);

  // cloudflared standalone binary (brew needs sudo on managed plans, so we
  // fetch the release binary into ~/.local/bin instead).
  const hasCf = await sshExec(ssh, `test -x ${CF_BIN} && echo yes || echo no`);
  if (hasCf.stdout.trim() !== 'yes') {
    await run('install cloudflared', `mkdir -p $HOME/.local/bin && curl -fL --retry 3 -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz && tar -xzf /tmp/cf.tgz -C $HOME/.local/bin && chmod +x ${CF_BIN}`, true);
  }
  await run('start tunnel', `pkill -f 'cloudflared tunnel --url' 2>/dev/null; nohup ${CF_BIN} tunnel --url http://localhost:${PORT} </dev/null >/tmp/cloudflared.log 2>&1 & sleep 1; echo started`);

  let url = null;
  for (let i = 0; i < 40; i++) {
    url = (await sshExec(ssh, "grep -Eo 'https://[a-z0-9-]+\\.trycloudflare\\.com' /tmp/cloudflared.log | head -1 || true")).stdout.trim();
    if (url) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('\n==================== PREVIEW READY ====================');
  if (url) {
    console.log(`Open: ${url}/simulators`);
    console.log(`Farm: ${url}/farm`);
  } else {
    console.log('No tunnel URL yet — log:\n' + (await sshExec(ssh, 'tail -n 25 /tmp/cloudflared.log')).stdout);
  }
  console.log('======================================================');
} finally {
  ssh.dispose();
}
