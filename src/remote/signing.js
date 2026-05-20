import { sshExec, sshUpload } from './ssh.js';
import { logger } from '../utils/logger.js';

const REMOTE_KEY_PATH = '/tmp/AuthKey.p8';
const REMOTE_SIGNING_DIR = '/tmp/rn-deploy-signing';
const BUILD_KEYCHAIN = 'rn-deploy-build.keychain';
const BUILD_KEYCHAIN_PASSWORD = 'rn-deploy';

const PROFILE_TYPE_FROM_DISTRIBUTION = {
  'app-store': 'IOS_APP_STORE',
  'ad-hoc': 'IOS_AD_HOC',
  'enterprise': 'IOS_IN_HOUSE',
  'development': 'IOS_APP_DEVELOPMENT',
};

export async function authenticateAsc(ssh, { keyId, issuerId, privateKeyPath }) {
  logger.info('Uploading App Store Connect API key to remote...');
  await sshUpload(ssh, privateKeyPath, REMOTE_KEY_PATH);
  await sshExec(ssh, `chmod 600 ${REMOTE_KEY_PATH}`);

  logger.info('Authenticating asc on remote...');
  await sshExec(
    ssh,
    `asc auth login --name "rn-deploy" --key-id ${keyId} --issuer-id ${issuerId} --private-key ${REMOTE_KEY_PATH} --bypass-keychain --network`
  );
  logger.success('asc authenticated on remote');
}

export async function cleanupAscCredentials(ssh) {
  await sshExec(ssh, `rm -f ${REMOTE_KEY_PATH}`).catch(() => {});
  await sshExec(ssh, 'asc auth logout --name rn-deploy 2>/dev/null || true').catch(() => {});
}

// Fetches certificates + provisioning profiles from App Store Connect onto the
// remote Mac, imports the certificate into a dedicated build keychain, and
// installs the .mobileprovision file so xcodebuild can find it.
//
// Requires that the chosen certificate's private key (p12) is reachable. The
// ASC API does NOT expose private keys for existing certificates, so options are:
//   1) Pre-stage a p12 via `asc signing sync` (encrypted git repo) — preferred
//   2) Let asc create a fresh cert+CSR on the remote (--create-missing)
export async function setupSigning(ssh, { bundleId, profileType, distribution, syncRepo, p12Password, createMissing = true }) {
  if (!bundleId) {
    throw new Error('signing.bundleId is required (set via app.json ios.bundleIdentifier or deploy.config.json signing.bundleId)');
  }

  const resolvedType = profileType || PROFILE_TYPE_FROM_DISTRIBUTION[distribution] || 'IOS_APP_STORE';
  logger.info(`Resolving signing assets (bundleId=${bundleId}, type=${resolvedType})`);

  await sshExec(ssh, `rm -rf ${REMOTE_SIGNING_DIR} && mkdir -p ${REMOTE_SIGNING_DIR}`);

  // Path A: sync from encrypted git repo (carries private keys)
  if (syncRepo) {
    logger.info(`Pulling signing assets from sync repo: ${syncRepo}`);
    await sshExec(
      ssh,
      `asc signing sync pull --repo "${syncRepo}" --output-dir ${REMOTE_SIGNING_DIR}`,
      { stream: true }
    );
  } else {
    // Path B: fetch from ASC API directly
    const fetchArgs = [
      'asc signing fetch',
      `--bundle-id ${bundleId}`,
      `--profile-type ${resolvedType}`,
      `--output ${REMOTE_SIGNING_DIR}`,
      createMissing ? '--create-missing' : '',
    ].filter(Boolean).join(' ');
    await sshExec(ssh, fetchArgs, { stream: true });
  }

  // Discover what was written
  const ls = await sshExec(ssh, `ls -1 ${REMOTE_SIGNING_DIR}`);
  const files = ls.stdout.split('\n').map(f => f.trim()).filter(Boolean);
  const p12 = files.find(f => f.endsWith('.p12'));
  const cer = files.find(f => f.endsWith('.cer'));
  const profile = files.find(f => f.endsWith('.mobileprovision'));

  if (!profile) {
    throw new Error(
      `No provisioning profile (.mobileprovision) found after asc signing fetch. Files: ${files.join(', ')}`
    );
  }

  // Set up a dedicated keychain so we don't pollute login.keychain
  logger.info('Creating dedicated build keychain on remote...');
  await sshExec(
    ssh,
    `security delete-keychain ${BUILD_KEYCHAIN} 2>/dev/null || true`
  );
  await sshExec(ssh, `security create-keychain -p "${BUILD_KEYCHAIN_PASSWORD}" ${BUILD_KEYCHAIN}`);
  await sshExec(ssh, `security set-keychain-settings -lut 21600 ${BUILD_KEYCHAIN}`);
  await sshExec(ssh, `security unlock-keychain -p "${BUILD_KEYCHAIN_PASSWORD}" ${BUILD_KEYCHAIN}`);
  // Add build keychain to user search list, keeping login.keychain available
  await sshExec(
    ssh,
    `security list-keychains -d user -s ${BUILD_KEYCHAIN} login.keychain-db`
  );

  // Import certificate material
  if (p12) {
    logger.info(`Importing ${p12} into build keychain...`);
    const pw = p12Password || process.env.ASC_P12_PASSWORD || '';
    await sshExec(
      ssh,
      `security import ${REMOTE_SIGNING_DIR}/${p12} -k ${BUILD_KEYCHAIN} -P "${pw}" -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productsign`
    );
    await sshExec(
      ssh,
      `security set-key-partition-list -S apple-tool:,apple: -s -k "${BUILD_KEYCHAIN_PASSWORD}" ${BUILD_KEYCHAIN}`
    ).catch(() => {
      // older macOS may not support this — non-fatal
    });
  } else if (cer) {
    logger.warn(`Only a public certificate (${cer}) was fetched. xcodebuild needs the matching private key.`);
    logger.warn('Configure signing.syncRepo to use asc signing sync, or pre-import a p12 via the build profile.');
    await sshExec(
      ssh,
      `security import ${REMOTE_SIGNING_DIR}/${cer} -k ${BUILD_KEYCHAIN} -T /usr/bin/codesign`
    );
  } else {
    throw new Error('No certificate (.p12 or .cer) found in signing output');
  }

  // Install provisioning profile via asc helper (drops into Xcode profiles dir)
  logger.info(`Installing provisioning profile ${profile}...`);
  await sshExec(
    ssh,
    `asc profiles local install --path ${REMOTE_SIGNING_DIR}/${profile}`
  );

  // Read profile metadata via asc (UUID + name + teamId)
  const meta = await sshExec(
    ssh,
    `asc profiles local list --output json`
  );
  let installedList = [];
  try { installedList = JSON.parse(meta.stdout); } catch { /* ignore */ }
  const installed = installedList.find(p => p.name && profile.includes(p.name)) || installedList[0] || {};

  // Also pull team & bundle from asc certs/profiles list as a fallback
  let teamId = installed.teamId || '';
  let profileName = installed.name || '';
  let profileUuid = installed.uuid || '';
  if (!teamId || !profileName) {
    try {
      const certs = JSON.parse((await sshExec(ssh, 'asc certificates list --output json')).stdout);
      const distCert = (Array.isArray(certs) ? certs : []).find(c =>
        (c.type || c.certificateType || '').includes('DISTRIBUTION')
      ) || certs?.[0];
      if (distCert) {
        teamId = teamId || distCert.teamId || distCert.attributes?.teamId || '';
      }
    } catch { /* ignore */ }
  }

  const signingInfo = {
    bundleId,
    teamId,
    profileName,
    profileUuid,
    profileType: resolvedType,
    keychain: BUILD_KEYCHAIN,
    keychainPassword: BUILD_KEYCHAIN_PASSWORD,
    signingDir: REMOTE_SIGNING_DIR,
  };

  if (!signingInfo.teamId) {
    logger.warn('Could not determine teamId automatically. ExportOptions.plist may need a manual teamID.');
  }

  logger.success(
    `Signing ready: team=${signingInfo.teamId || '?'} profile=${signingInfo.profileName || '?'} bundle=${bundleId}`
  );
  return signingInfo;
}

export async function teardownSigning(ssh) {
  await sshExec(ssh, `security delete-keychain ${BUILD_KEYCHAIN} 2>/dev/null || true`).catch(() => {});
  await sshExec(ssh, `rm -rf ${REMOTE_SIGNING_DIR}`).catch(() => {});
}

export function generateExportOptionsPlist({ method = 'app-store', teamId, bundleId, profileName, profileUuid }) {
  const profileRef = profileUuid || profileName;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${method}</string>
    <key>teamID</key>
    <string>${teamId}</string>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>manual</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>provisioningProfiles</key>
    <dict>
        <key>${bundleId}</key>
        <string>${profileRef}</string>
    </dict>
</dict>
</plist>`;
}
