import { randomUUID } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { sshExec } from '../remote/ssh.js';
import { createStorageAdapter } from '../storage/index.js';
import { generateManifestPlist } from './manifest.js';
import { generateInstallPage } from './install-page.js';
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
  const slug = sanitize(appMeta.slug || profile.scheme || 'app');
  const prefix = `builds/${slug}/${buildId}`;

  const ipaKey = `${prefix}/app.ipa`;
  const manifestKey = `${prefix}/manifest.plist`;
  const pageKey = `${prefix}/index.html`;
  const metaKey = `${prefix}/build.json`;

  const ipaUrl = storage.publicUrlFor(ipaKey);
  const manifestUrl = storage.publicUrlFor(manifestKey);
  const installPageUrl = storage.publicUrlFor(pageKey);
  const itmsServicesUrl = `itms-services://?action=download-manifest;url=${encodeURI(manifestUrl)}`;

  // 1. Upload the IPA directly from the build host (saves bandwidth).
  logger.info(`Uploading IPA to storage (${storage.kind}://${storage.bucket}/${ipaKey})`);
  const uploadCmd = storage.remoteUploadCommand(remoteIpaPath, ipaKey, {
    contentType: 'application/octet-stream',
  });
  // Ensure aws CLI exists on the Mac. If not, fall back to local upload.
  const hasAws = await sshExec(ssh, 'command -v aws >/dev/null 2>&1 && echo yes || echo no');
  if (hasAws.stdout.trim() === 'yes') {
    await sshExec(ssh, uploadCmd);
  } else {
    logger.warn('aws CLI missing on build host — falling back to local upload (slower).');
    if (!appMeta.localIpaPath) {
      throw new Error('Cannot fall back to local upload: localIpaPath missing from appMeta.');
    }
    await storage.putFile(appMeta.localIpaPath, ipaKey, { contentType: 'application/octet-stream' });
  }

  // 2. manifest.plist
  const manifest = generateManifestPlist({
    ipaUrl,
    bundleId: signingInfo.bundleId,
    bundleVersion: appMeta.version || '1.0.0',
    title: appMeta.title || profile.scheme || 'App',
    displayImageUrl: appMeta.displayImageUrl,
    fullSizeImageUrl: appMeta.fullSizeImageUrl,
  });
  await storage.putString(manifest, manifestKey, { contentType: 'application/x-plist' });

  // 3. Per-build landing page
  const page = generateInstallPage({
    appTitle: appMeta.title || profile.scheme || 'App',
    bundleId: signingInfo.bundleId,
    version: appMeta.version,
    buildNumber: appMeta.buildNumber,
    commit: appMeta.commit,
    profile: profileName,
    distribution,
    itmsServicesUrl,
    ipaUrl,
    createdAt: new Date().toISOString(),
  });
  await storage.putString(page, pageKey, { contentType: 'text/html; charset=utf-8' });

  // 4. Metadata blob — phase-2 dashboard will index these.
  const metadata = {
    id: buildId,
    slug,
    profile: profileName,
    distribution,
    scheme: profile.scheme,
    bundleId: signingInfo.bundleId,
    version: appMeta.version,
    buildNumber: appMeta.buildNumber,
    commit: appMeta.commit,
    branch: appMeta.branch,
    createdAt: new Date().toISOString(),
    ipaUrl,
    manifestUrl,
    installPageUrl,
    itmsServicesUrl,
  };
  await storage.putString(JSON.stringify(metadata, null, 2), metaKey, {
    contentType: 'application/json',
  });

  printQrAndLinks({ installPageUrl, itmsServicesUrl, ipaUrl });

  return metadata;
}

function printQrAndLinks({ installPageUrl, itmsServicesUrl, ipaUrl }) {
  process.stdout.write('\n');
  logger.success('Build published — scan the QR code with your iPhone camera:');
  process.stdout.write('\n');
  qrcode.generate(installPageUrl, { small: true }, (qr) => {
    process.stdout.write(qr + '\n');
  });
  logger.info(`Install page : ${installPageUrl}`);
  logger.info(`itms-services: ${itmsServicesUrl}`);
  logger.info(`Direct IPA   : ${ipaUrl}`);
  process.stdout.write('\n');
}

function sanitize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}
