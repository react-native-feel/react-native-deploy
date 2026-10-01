import chalk from 'chalk';
import { loadConfig, saveConfig } from '../config/loader.js';
import { SECRET_NAMES } from '../config/schema.js';
import { setRepoSecrets, listRepoSecrets, deleteRepoSecret } from '../github/secrets.js';
import { createIosCredentials, verifyAscAuth } from '../credentials/ios.js';
import { createAndroidKeystore, importAndroidKeystore } from '../credentials/android.js';
import { requireBinaries } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { input, confirm } from '../utils/prompts.js';

/** Shows which signing secrets the repo actually has, without revealing values. */
export async function credentialsListCommand() {
  const config = loadConfig();
  const repo = config.github.repo;
  const present = new Set((await listRepoSecrets(repo)).map((s) => s.name));

  logger.plain();
  logger.plain(chalk.bold(`Signing secrets on ${repo}`));
  logger.plain();

  for (const [platform, names] of Object.entries(SECRET_NAMES)) {
    logger.plain(chalk.bold(`  ${platform}`));
    for (const name of Object.values(names)) {
      const mark = present.has(name) ? chalk.green('✓') : chalk.red('✗');
      logger.plain(`    ${mark} ${name}`);
    }
  }

  logger.plain();
  if (config.ios?.teamId) {
    logger.dim(`  team ${config.ios.teamId} · bundle ${config.ios.bundleId}`);
    logger.dim(`  profile "${config.ios.profileName}"`);
  }
}

/**
 * Replaces the iOS certificate and profile. Apple caps distribution certs at
 * two per team, so this refuses to run blind and tells you how to revoke.
 */
export async function credentialsRotateIosCommand(options = {}) {
  await requireBinaries(['openssl', 'asc']);
  await verifyAscAuth();

  const config = loadConfig();
  if (!config.ios?.bundleId) {
    throw new Error('config.ios.bundleId is empty. Run "rn-build setup" first.');
  }

  logger.warn('This creates a NEW distribution certificate and provisioning profile.');
  logger.warn(`The old ones (cert ${config.ios.certificateId || 'unknown'}) are left in place —`);
  logger.warn('revoke them yourself once builds are green.');
  if (!options.yes && !(await confirm('Continue?', false))) return;

  const appName = await input('App name (for the certificate subject):', config.ios.profileName?.split(' ')[0] || 'App');
  const email = await input('Contact email:', process.env.EMAIL || 'rn-build@localhost');
  const profileName = await input(
    'New provisioning profile name (must be unique):',
    `${appName} app-store ${new Date().toISOString().slice(0, 10)}`
  );

  const creds = await createIosCredentials({
    bundleId: config.ios.bundleId,
    appName,
    distribution: options.distribution || 'app-store',
    commonName: appName,
    email,
    profileName,
  });

  await setRepoSecrets(config.github.repo, {
    [SECRET_NAMES.ios.p12]: creds.p12Base64,
    [SECRET_NAMES.ios.p12Password]: creds.p12Password,
    [SECRET_NAMES.ios.profile]: creds.profileBase64,
  });

  config.ios = {
    ...config.ios,
    teamId: creds.teamId,
    profileName: creds.profileName,
    certificateId: creds.certificateId,
    profileId: creds.profileId,
  };
  saveConfig(config);

  logger.success('iOS credentials rotated and secrets updated.');
  logger.dim('Revoke the old certificate with: asc certificates revoke --id ID --confirm');
}

export async function credentialsRotateAndroidCommand(options = {}) {
  await requireBinaries(['keytool']);
  const config = loadConfig();

  logger.error('A new keystore CANNOT sign updates to an app already on Google Play.');
  logger.error('Only do this for an app that has never been published, or if you use');
  logger.error('Play App Signing and are rotating the upload key deliberately.');
  if (!options.yes && !(await confirm('Really generate a new keystore?', false))) return;

  const appName = await input('App name:', config.android?.package?.split('.').pop() || 'App');
  const creds = options.import
    ? await importAndroidKeystore({
        path: options.import,
        storePassword: await input('Keystore password:'),
        keyAlias: await input('Key alias:', 'upload'),
        keyPassword: await input('Key password (blank = same):', ''),
      })
    : await createAndroidKeystore({ appName });

  await setRepoSecrets(config.github.repo, {
    [SECRET_NAMES.android.keystore]: creds.keystoreBase64,
    [SECRET_NAMES.android.storePassword]: creds.storePassword,
    [SECRET_NAMES.android.keyAlias]: creds.keyAlias,
    [SECRET_NAMES.android.keyPassword]: creds.keyPassword,
  });

  logger.success('Android keystore secrets updated.');
}

export async function credentialsClearCommand(options = {}) {
  const config = loadConfig();
  const repo = config.github.repo;
  const names = Object.values(SECRET_NAMES).flatMap((group) => Object.values(group));

  logger.warn(`This deletes ${names.length} secrets from ${repo}. Builds will fail until re-run of setup.`);
  if (!options.yes && !(await confirm('Delete them?', false))) return;

  for (const name of names) {
    try {
      await deleteRepoSecret(repo, name);
      logger.dim(`  deleted ${name}`);
    } catch (err) {
      if (/404/.test(err.message)) continue;
      throw err;
    }
  }
  logger.success('Signing secrets removed.');
}
