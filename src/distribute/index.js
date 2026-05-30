import { randomUUID } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { sshExec } from '../remote/ssh.js';
import { createStorageAdapter } from '../storage/index.js';
import { generateManifestPlist } from './manifest.js';
import { generateInstallPage, generateSimulatorInstallPage } from './install-page.js';
import { appendToIndex, sanitizeSlug } from './registry.js';
import { logger } from '../utils/logger.js';

// Phase-1 distribution: upload the freshly-built IPA + a manifest.plist +
// a static install landing page to object storage, then print URLs + a
// terminal QR code so the user can install on a phone.
//
// Skipped silently when:
//   - no storage block in config (back-compat), or
//   - distribution === "app-store" (TestFlight is the install channel)
export async function distributeBuild({
  ssh,
  config,
  profile,
  profileName,
  remoteIpaPath,
  signingInfo,
  appMeta,
}) {
  const storageConfig = config.storage;
  if (!storageConfig) {
    logger.debug('No storage config; skipping OTA distribute step.');
    return null;
  }

  const distribution = profile.distribution || 'app-store';
  if (distribution === 'app-store') {
    logger.debug('distribution=app-store; skipping OTA distribute (use TestFlight).');
    return null;
  }

  const storage = createStorageAdapter(storageConfig);

  const buildId = randomUUID();
  const slug = sanitizeSlug(appMeta.slug || profile.scheme || 'app');
  const prefix = `builds/${slug}/${buildId}`;
  const isSimulator = distribution === 'simulator';
  const createdAt = appMeta.createdAt || new Date().toISOString();

  const artifactKey = isSimulator ? `${prefix}/app.app.tgz` : `${prefix}/app.ipa`;
  const pageKey = `${prefix}/index.html`;
  const metaKey = `${prefix}/build.json`;

  const artifactUrl = storage.publicUrlFor(artifactKey);
  const installPageUrl = storage.publicUrlFor(pageKey);

  // 1. Upload the artifact directly from the build host (saves bandwidth).
  logger.info(`Uploading artifact to storage (${storage.kind}://${storage.bucket}/${artifactKey})`);
  const uploadCmd = storage.remoteUploadCommand(remoteIpaPath, artifactKey, {
    contentType: 'application/octet-stream',
  });
  const hasAws = await sshExec(ssh, 'command -v aws >/dev/null 2>&1 && echo yes || echo no');
  if (hasAws.stdout.trim() === 'yes') {
    await sshExec(ssh, uploadCmd);
  } else {
    logger.warn('aws CLI missing on build host — falling back to local upload (slower).');
    if (!appMeta.localIpaPath) {
      throw new Error('Cannot fall back to local upload: localIpaPath missing from appMeta.');
    }
    await storage.putFile(appMeta.localIpaPath, artifactKey, { contentType: 'application/octet-stream' });
  }

  let manifestUrl = null;
  let itmsServicesUrl = null;

  if (isSimulator) {
    // Simulator: no manifest/itms — just a page with a simctl one-liner.
    const page = generateSimulatorInstallPage({
      appTitle: appMeta.title || profile.scheme || 'App',
      bundleId: signingInfo?.bundleId,
      version: appMeta.version,
      buildNumber: appMeta.buildNumber,
      commit: appMeta.commit,
      profile: profileName,
      artifactUrl,
      createdAt,
    });
    await storage.putString(page, pageKey, { contentType: 'text/html; charset=utf-8' });
  } else {
    const manifestKey = `${prefix}/manifest.plist`;
    manifestUrl = storage.publicUrlFor(manifestKey);
    itmsServicesUrl = `itms-services://?action=download-manifest;url=${encodeURI(manifestUrl)}`;

    const manifest = generateManifestPlist({
      ipaUrl: artifactUrl,
      bundleId: signingInfo.bundleId,
      bundleVersion: appMeta.version || '1.0.0',
      title: appMeta.title || profile.scheme || 'App',
      displayImageUrl: appMeta.displayImageUrl,
      fullSizeImageUrl: appMeta.fullSizeImageUrl,
    });
    await storage.putString(manifest, manifestKey, { contentType: 'application/x-plist' });

    const page = generateInstallPage({
      appTitle: appMeta.title || profile.scheme || 'App',
      bundleId: signingInfo.bundleId,
      version: appMeta.version,
      buildNumber: appMeta.buildNumber,
      commit: appMeta.commit,
      profile: profileName,
      distribution,
      itmsServicesUrl,
      ipaUrl: artifactUrl,
      createdAt,
    });
    await storage.putString(page, pageKey, { contentType: 'text/html; charset=utf-8' });
  }

  // Metadata blob — also the unit consumed by the build registry index.
  const metadata = {
    id: buildId,
    slug,
    profile: profileName,
    distribution,
    artifactKind: isSimulator ? 'simulator-app' : 'ipa',
    scheme: profile.scheme,
    bundleId: signingInfo?.bundleId,
    version: appMeta.version,
    buildNumber: appMeta.buildNumber,
    commit: appMeta.commit,
    branch: appMeta.branch,
    createdAt,
    artifactUrl,
    installPageUrl,
    manifestUrl,
    itmsServicesUrl,
  };
  await storage.putString(JSON.stringify(metadata, null, 2), metaKey, {
    contentType: 'application/json',
  });

  // Append to the per-app build registry. Best-effort — the artifact is already
  // uploaded, so a registry hiccup shouldn't fail the build.
  try {
    await appendToIndex(storage, slug, metadata);
  } catch (err) {
    logger.warn(`Could not update build registry index: ${err.message}`);
  }

  printQrAndLinks({ installPageUrl, itmsServicesUrl, artifactUrl, isSimulator });

  return metadata;
}

function printQrAndLinks({ installPageUrl, itmsServicesUrl, artifactUrl, isSimulator }) {
  process.stdout.write('\n');
  if (isSimulator) {
    logger.success('Simulator build published:');
    process.stdout.write('\n');
    logger.info(`Install page : ${installPageUrl}`);
    logger.info(`Direct .app  : ${artifactUrl}`);
    logger.info('Install on a booted simulator:');
    logger.info(`  curl -L "${artifactUrl}" | tar -xz && xcrun simctl install booted *.app`);
  } else {
    logger.success('Build published — scan the QR code with your iPhone camera:');
    process.stdout.write('\n');
    qrcode.generate(installPageUrl, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
    });
    logger.info(`Install page : ${installPageUrl}`);
    logger.info(`itms-services: ${itmsServicesUrl}`);
    logger.info(`Direct IPA   : ${artifactUrl}`);
  }
  process.stdout.write('\n');
}
