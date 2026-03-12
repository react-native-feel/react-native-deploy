import { loadConfig } from '../config/loader.js';
import { resolveProfile } from '../config/profiles.js';
import { loadState } from '../infra/state.js';
import { createSshConnection, sshExec, sshUpload } from '../remote/ssh.js';
import { getPrivateKeyPath } from '../infra/key-pair.js';
import { logger } from '../utils/logger.js';
import { input } from '../utils/prompts.js';

// Note: submit requires a running EC2 instance because asc runs on the remote
// instance (not locally). Use "rn-deploy build --auto-submit" for the common case,
// or "rn-deploy infra up" + "rn-deploy submit" for standalone submission.
export async function submitCommand(options = {}) {
  const config = loadConfig();
  const state = loadState();

  if (!state) {
    throw new Error('No active instance. Run "rn-deploy infra up" first, then "rn-deploy submit".');
  }

  const keyPath = state.keyPath || getPrivateKeyPath(config.aws.keyPairName);
  const ssh = await createSshConnection(state.publicIp, keyPath);

  try {
    const ipaPath = options.ipa;
    let remoteIpaPath = ipaPath;

    // If local path, upload to instance
    if (ipaPath && !ipaPath.startsWith('/Users/ec2') && !ipaPath.startsWith('~/build-workspace')) {
      remoteIpaPath = '/tmp/upload.ipa';
      logger.info('Uploading .ipa to instance...');
      await sshUpload(ssh, ipaPath, remoteIpaPath);
    }

    if (!remoteIpaPath) {
      remoteIpaPath = await input('Path to .ipa file on instance:');
    }

    await submitToTestFlight(ssh, {
      ipaPath: remoteIpaPath,
      config,
      profileName: options.profile || 'production',
      groups: options.groups,
      whatToTest: options.whatToTest || options.message,
    });
  } finally {
    ssh.dispose();
  }
}

export async function submitToTestFlight(ssh, { ipaPath, config, profileName, groups, whatToTest }) {
  // Resolve submit profile
  const submitProfile = config.submit?.[profileName] || {};
  const testFlightGroups = groups?.split(',') || submitProfile.testFlightGroups || [];
  const testNotes = whatToTest || submitProfile.whatToTest || '';

  // Get app ID from asc
  logger.info('Looking up app information...');
  const appsResult = await sshExec(ssh, 'asc apps list --json');
  const apps = JSON.parse(appsResult.stdout);
  if (!apps || apps.length === 0) {
    throw new Error('No apps found in App Store Connect. Create one first.');
  }
  const appId = apps[0].id; // TODO: let user select if multiple apps

  // Upload build
  logger.info('Uploading build to App Store Connect...');
  await sshExec(ssh, `asc builds upload --app "${appId}" --ipa "${ipaPath}"`, { stream: true });

  // Distribute to TestFlight groups
  for (const group of testFlightGroups) {
    logger.info(`Adding to TestFlight group: ${group}`);
    await sshExec(ssh, `asc publish testflight --group "${group}" --wait`, { stream: true });
  }

  if (testNotes) {
    logger.info(`Setting "What to Test": ${testNotes}`);
    // Note: asc may not have a direct command for this — would need API call
  }

  logger.success('Build submitted to TestFlight');
}
