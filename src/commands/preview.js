import { loadConfig } from '../config/loader.js';
import { connectManagedHost } from '../remote/connect.js';
import { createStorageAdapter } from '../storage/index.js';
import { deriveSlug, readIndex } from '../distribute/registry.js';
import {
  ensureBaguette,
  ensureCloudflared,
  bootSimulator,
  installSimulatorApp,
  startTunnel,
  DEFAULT_BAGUETTE_PORT,
} from '../remote/baguette.js';
import { logger } from '../utils/logger.js';

// Live-preview a simulator build: install it on the host's simulator and expose
// it through baguette + a cloudflared quick tunnel. Works on any host rn-deploy
// connects to (not provisions) — currently macincloud and cua.
//
// The artifact comes from --artifact-url, or the newest simulator build in the
// R2/S3 registry for this app (needs a "storage" block in deploy.config.json).
export async function previewCommand(options = {}) {
  const config = loadConfig(process.cwd());
  const kind = config.host?.kind;
  if (kind !== 'macincloud' && kind !== 'cua') {
    throw new Error(`preview needs host.kind=macincloud or cua (got "${kind ?? 'none'}")`);
  }

  const port = options.port ? parseInt(options.port, 10) : DEFAULT_BAGUETTE_PORT;

  // Resolve which .app to install.
  let artifactUrl = options.artifactUrl;
  if (!artifactUrl) {
    if (!config.storage) {
      throw new Error('preview needs either --artifact-url or a "storage" block in deploy.config.json');
    }
    const slug = options.slug || deriveSlug(config);
    const storage = createStorageAdapter(config.storage);
    const builds = await readIndex(storage, slug);
    const latest = builds.find((b) => b.artifactKind === 'simulator-app');
    if (!latest) throw new Error(`no simulator build found in the registry for slug "${slug}"`);
    artifactUrl = latest.artifactUrl;
    logger.info(`Latest simulator build for ${slug}: ${latest.id.slice(0, 8)} (${latest.version || '—'})`);
  }

  const target = kind === 'cua' ? `cua sandbox ${config.host.name}` : config.host.host;
  logger.step(1, 5, `Connecting to ${target}`);
  const ssh = await connectManagedHost(config.host);

  try {
    logger.step(2, 5, 'Installing baguette + cloudflared');
    const baguetteBin = await ensureBaguette(ssh);
    const cfBin = await ensureCloudflared(ssh);

    logger.step(3, 5, 'Booting simulator + installing the build');
    const udid = await bootSimulator(ssh);
    const bundleId = await installSimulatorApp(ssh, udid, artifactUrl);
    logger.info(`Installed ${bundleId} on simulator ${udid}`);

    logger.step(4, 5, 'Starting baguette + cloudflared tunnel');
    const url = await startTunnel(ssh, baguetteBin, cfBin, port);

    logger.step(5, 5, 'Preview ready');
    logger.success('Live preview URL (open in a browser):');
    logger.info(`  ${url}/simulators`);
    logger.info(`  ${url}/farm`);
    logger.info('');
    logger.info('The tunnel keeps running on the host after this command exits.');
    return url;
  } finally {
    ssh.dispose();
  }
}
