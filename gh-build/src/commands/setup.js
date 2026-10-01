import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getToken } from '../github/auth.js';
import { getRepo } from '../github/api.js';
import { setRepoSecrets } from '../github/secrets.js';
import { loginCommand } from './login.js';
import { writeWorkflowLocally, workflowPushCommand } from './workflow.js';
import { createIosCredentials, verifyAscAuth } from '../credentials/ios.js';
import { createAndroidKeystore, importAndroidKeystore } from '../credentials/android.js';
import { saveConfig, configExists, loadConfig } from '../config/loader.js';
import { SECRET_NAMES, CONFIG_FILE, WORKFLOW_PATH } from '../config/schema.js';
import { detectRepoSlug, detectBranch, detectApp } from '../utils/detect.js';
import { importEasProfiles } from '../config/eas-import.js';
import { requireBinaries } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { input, confirm, select } from '../utils/prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_TEMPLATE = join(__dirname, '../../templates/rn-build.config.json');

export async function setupCommand(options = {}) {
  logger.plain();
  logger.plain(chalk.bold('rn-build setup'));
  logger.dim('Builds run on GitHub Actions runners and are billed to your GitHub account.');
  logger.plain();

  const totalSteps = 6;

  // ── 1. GitHub auth ────────────────────────────────────────────────────────
  logger.step(1, totalSteps, 'GitHub authentication');
  if (!getToken()) {
    await loginCommand();
  } else {
    logger.success('Using the stored GitHub token.');
  }

  // ── 2. Repository ─────────────────────────────────────────────────────────
  logger.step(2, totalSteps, 'Repository');
  const existingConfig = configExists() ? loadConfig() : null;
  const detectedRepo = await detectRepoSlug();
  const detectedBranch = await detectBranch();

  const repo = options.repo
    || await input('GitHub repo (owner/name):', existingConfig?.github?.repo || detectedRepo || '');
  const ref = options.ref
    || await input('Branch to build from:', existingConfig?.github?.ref || detectedBranch || 'main');

  const repoInfo = await getRepo(repo);
  logger.success(`${repoInfo.full_name} — ${repoInfo.private ? 'private' : 'public'}`);
  printBillingNote(repoInfo.private);

  // ── 3. App details ────────────────────────────────────────────────────────
  logger.step(3, totalSteps, 'App details');
  const app = detectApp();
  if (app.name) logger.dim(`Detected "${app.name}" (${app.buildType} project)`);

  const platforms = options.platform
    || await select('Which platforms should rn-build build?', ['all', 'ios', 'android']);
  const wantsIos = platforms === 'all' || platforms === 'ios';
  const wantsAndroid = platforms === 'all' || platforms === 'android';

  const appName = await input('App name:', app.name);
  const buildType = await select('Project type:', app.buildType === 'expo'
    ? ['expo', 'classic']
    : ['classic', 'expo']);

  const config = JSON.parse(readFileSync(CONFIG_TEMPLATE, 'utf-8'));
  config.github = { repo, ref };
  for (const profile of Object.values(config.build)) {
    if (profile.buildType) profile.buildType = buildType;
    if (profile.platform) profile.platform = platforms;
    if (profile.packageManager) profile.packageManager = app.packageManager;
  }
  logger.dim(`Package manager: ${app.packageManager} (from the committed lockfile)`);

  // Carry over per-profile env from eas.json so an EAS-configured app keeps
  // building the same way — APP_VARIANT and friends decide which icon, API
  // host, and channel end up in the binary.
  const imported = importEasProfiles(config.build);
  if (imported.length) {
    logger.success(`Imported env from eas.json for: ${imported.join(', ')}`);
    for (const name of imported) {
      const vars = Object.keys(config.build[name].env);
      logger.dim(`  ${name}: ${vars.join(', ')}`);
    }
  }

  // ── 4. iOS signing ────────────────────────────────────────────────────────
  logger.step(4, totalSteps, 'iOS signing');
  if (wantsIos) {
    await requireBinaries(['openssl', 'asc']);
    await verifyAscAuth();

    const bundleId = await input('iOS bundle identifier:', app.bundleId);
    const scheme = await input('Xcode scheme:', app.scheme || appName.replace(/[^A-Za-z0-9]/g, ''));

    logger.plain();
    logger.dim('Generating a distribution certificate and provisioning profile.');
    logger.dim('The private key is created here and never leaves this machine except');
    logger.dim('as an encrypted GitHub secret.');
    logger.plain();

    const email = await input('Contact email for the certificate:', process.env.EMAIL || '');
    const creds = await createIosCredentials({
      bundleId,
      appName,
      distribution: 'app-store',
      commonName: appName,
      email: email || 'rn-build@localhost',
    });

    config.ios = {
      bundleId,
      scheme,
      teamId: creds.teamId,
      profileName: creds.profileName,
      certificateId: creds.certificateId,
      profileId: creds.profileId,
    };

    logger.info(`Pushing iOS secrets to ${repo}...`);
    const names = await setRepoSecrets(repo, {
      [SECRET_NAMES.ios.p12]: creds.p12Base64,
      [SECRET_NAMES.ios.p12Password]: creds.p12Password,
      [SECRET_NAMES.ios.profile]: creds.profileBase64,
    });
    logger.success(`Set ${names.length} iOS secrets: ${names.join(', ')}`);
  } else {
    logger.dim('Skipped (Android-only setup).');
    delete config.ios;
    for (const profile of Object.values(config.build)) profile.platform = 'android';
  }

  // ── 5. Android signing ────────────────────────────────────────────────────
  logger.step(5, totalSteps, 'Android signing');
  if (wantsAndroid) {
    await requireBinaries(['keytool']);
    if (!app.androidPackage) {
      logger.warn(
        'app.json has no expo.android.package. "expo prebuild --platform android" ' +
        'needs one, so add it there too — otherwise the Android job will fail.'
      );
    }
    const androidPackage = await input('Android package name:', app.androidPackage || app.bundleId);
    config.android = { package: androidPackage, module: 'app' };

    const hasExisting = await confirm(
      'Do you already have a release keystore for this app? (say no for a new app)',
      false
    );

    let creds;
    if (hasExisting) {
      const path = await input('Path to your .jks/.keystore:');
      const storePassword = await input('Keystore password:');
      const keyAlias = await input('Key alias:', 'upload');
      const keyPassword = await input('Key password (blank = same as keystore):', '');
      creds = await importAndroidKeystore({ path, storePassword, keyPassword, keyAlias });
    } else {
      creds = await createAndroidKeystore({ appName });
    }

    logger.info(`Pushing Android secrets to ${repo}...`);
    const names = await setRepoSecrets(repo, {
      [SECRET_NAMES.android.keystore]: creds.keystoreBase64,
      [SECRET_NAMES.android.storePassword]: creds.storePassword,
      [SECRET_NAMES.android.keyAlias]: creds.keyAlias,
      [SECRET_NAMES.android.keyPassword]: creds.keyPassword,
    });
    logger.success(`Set ${names.length} Android secrets: ${names.join(', ')}`);
  } else {
    logger.dim('Skipped (iOS-only setup).');
    delete config.android;
    for (const profile of Object.values(config.build)) profile.platform = 'ios';
  }

  // ── 6. Workflow + config ──────────────────────────────────────────────────
  logger.step(6, totalSteps, 'Workflow and config');
  const configFile = saveConfig(config);
  logger.success(`Wrote ${chalk.cyan(CONFIG_FILE)}`);

  const { overwritten } = writeWorkflowLocally();
  logger.success(`${overwritten ? 'Updated' : 'Wrote'} ${chalk.cyan(WORKFLOW_PATH)}`);

  const push = await confirm(
    `Commit the workflow to ${repo}@${ref} now (via the GitHub API)?`,
    false
  );
  if (push) {
    await workflowPushCommand({ yes: true });
  } else {
    logger.plain();
    logger.plain('Commit it yourself before the first build:');
    logger.dim(`  git add ${WORKFLOW_PATH} ${CONFIG_FILE}`);
    logger.dim(`  git commit -m "ci: add rn-build workflow" && git push`);
  }

  logger.plain();
  logger.success('Setup complete.');
  logger.plain(`Run a build with: ${chalk.cyan('rn-build build --profile production')}`);
  return configFile;
}

function printBillingNote(isPrivate) {
  logger.plain();
  if (isPrivate) {
    logger.warn('Private repo: macOS minutes bill at a 10x multiplier against your');
    logger.warn('included minutes (a Free plan\'s 2,000/mo ≈ 200 macOS minutes), then');
    logger.warn('per-minute. Ubuntu (Android) is 1x. Larger macOS runners never use');
    logger.warn('included minutes at all.');
  } else {
    logger.success('Public repo: standard GitHub-hosted runners are free, macOS included.');
  }
  logger.dim('Current rates: https://docs.github.com/en/billing/managing-billing-for-github-actions');
  logger.plain();
}
