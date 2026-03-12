import { sshExec, sshUpload } from './ssh.js';
import { logger } from '../utils/logger.js';

export async function setupSigning(ssh, { keyId, issuerId, privateKeyPath }) {
  const remoteKeyPath = '/tmp/AuthKey.p8';

  // Upload .p8 key
  logger.info('Uploading App Store Connect API key...');
  await sshUpload(ssh, privateKeyPath, remoteKeyPath);

  // Authenticate with asc
  logger.info('Authenticating with App Store Connect...');
  await sshExec(ssh, `asc auth login --name "rn-deploy" --key-id ${keyId} --issuer-id ${issuerId} --private-key ${remoteKeyPath}`);

  // Delete the key from the instance
  await sshExec(ssh, `rm -f ${remoteKeyPath}`);
  logger.success('App Store Connect authentication complete (key removed from instance)');
}

export async function fetchSigningAssets(ssh) {
  logger.info('Fetching signing certificates and profiles...');

  // List certificates to get teamId
  const certResult = await sshExec(ssh, 'asc certificates list --json');
  const certs = JSON.parse(certResult.stdout);
  if (!certs || certs.length === 0) {
    throw new Error('No signing certificates found. Create one in App Store Connect.');
  }
  logger.debug(`Found ${certs.length} certificate(s)`);

  // List provisioning profiles to get profileName and bundleId
  const profileResult = await sshExec(ssh, 'asc profiles list --json');
  const profiles = JSON.parse(profileResult.stdout);
  if (!profiles || profiles.length === 0) {
    throw new Error('No provisioning profiles found. Create one in App Store Connect.');
  }
  logger.debug(`Found ${profiles.length} profile(s)`);

  // Extract signing info — use first distribution cert and first App Store profile
  const distCert = certs.find(c => c.type === 'IOS_DISTRIBUTION' || c.type === 'DISTRIBUTION') || certs[0];
  const appProfile = profiles.find(p => p.type === 'IOS_APP_STORE') || profiles[0];

  // Get bundle ID from profiles list
  const bundleIdResult = await sshExec(ssh, 'asc bundle-ids list --json');
  const bundleIds = JSON.parse(bundleIdResult.stdout);
  const bundleId = bundleIds?.[0]?.identifier || 'com.example.app';

  const signingInfo = {
    teamId: distCert.teamId || distCert.attributes?.teamId || '',
    profileName: appProfile.name || appProfile.attributes?.name || '',
    bundleId,
    certificates: certs,
    profiles,
  };

  logger.success(`Signing assets verified (team: ${signingInfo.teamId}, bundle: ${signingInfo.bundleId})`);
  return signingInfo;
}

export function generateExportOptionsPlist({ method = 'app-store', teamId, bundleId, profileName }) {
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
    <key>provisioningProfiles</key>
    <dict>
        <key>${bundleId}</key>
        <string>${profileName}</string>
    </dict>
</dict>
</plist>`;
}
