import chalk from 'chalk';

import { EasJsonAccessor } from '../easjson/accessor.js';
import { EasJsonUtils } from '../easjson/utils.js';
import { GitHubClient, clearToken, readAuth, saveToken } from '../github/api.js';
import { Log, die, link, printJson, setJsonMode } from '../utils/logger.js';
import { loadProjectContext } from '../utils/project.js';

/**
 * `eas config` — shows what a profile actually resolves to.
 *
 * This is the single most useful debugging command in EAS, because `extends`
 * chains plus platform blocks plus schema defaults mean the effective profile is
 * rarely what the file looks like. Worth having exact.
 */
export async function config({ options }) {
  setJsonMode(options.json);
  const project = loadProjectContext();
  if (!project.hasEasJson) {
    die('eas.json could not be found. Run "rnd build:configure" to create one.');
  }
  const accessor = EasJsonAccessor.fromProjectPath(project.projectRoot);
  const platform = options.platform ?? 'ios';
  const profileName = options.profile ?? 'production';

  let buildProfile;
  try {
    buildProfile = await EasJsonUtils.getBuildProfileAsync(accessor, platform, profileName);
  } catch (err) {
    die(err.message);
  }
  const submitProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    platform,
    options.profile
  ).catch(() => null);

  const payload = {
    platform,
    profile: profileName,
    appConfig: project.appConfig,
    buildProfile,
    submitProfile,
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  Log.log('');
  Log.log(chalk.bold(`Resolved build profile "${profileName}" (${platform})`));
  for (const [key, value] of Object.entries(buildProfile)) {
    Log.log(`  ${chalk.dim(key.padEnd(22))} ${format(value)}`);
  }
  if (submitProfile) {
    Log.log('');
    Log.log(chalk.bold(`Resolved submit profile (${platform})`));
    for (const [key, value] of Object.entries(submitProfile)) {
      Log.log(`  ${chalk.dim(key.padEnd(22))} ${format(value)}`);
    }
  }
  Log.log('');
}

function format(value) {
  if (value === undefined || value === null) return chalk.dim('—');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export async function projectInfo() {
  const project = loadProjectContext();
  Log.log('');
  Log.log(`  ${chalk.dim('Name')}        ${project.appConfig.name ?? '—'}`);
  Log.log(`  ${chalk.dim('Slug')}        ${project.appConfig.slug ?? '—'}`);
  Log.log(`  ${chalk.dim('Version')}     ${project.appConfig.version ?? '—'}`);
  Log.log(`  ${chalk.dim('Bundle ID')}   ${project.appConfig.ios.bundleIdentifier ?? '—'}`);
  Log.log(`  ${chalk.dim('Package')}     ${project.appConfig.android.package ?? '—'}`);
  Log.log(`  ${chalk.dim('Repository')}  ${project.repo ?? '—'}`);
  Log.log(`  ${chalk.dim('Branch')}      ${project.git.branch ?? '—'}${project.git.isDirty ? chalk.yellow(' (uncommitted changes)') : ''}`);
  Log.log(`  ${chalk.dim('Workflow')}    ${project.isBare ? 'bare (native dirs committed)' : 'managed (prebuild on the runner)'}`);
  Log.log(`  ${chalk.dim('Lockfile')}    ${project.lockfiles[0] ?? 'none'}`);
  Log.log(`  ${chalk.dim('eas.json')}    ${project.hasEasJson ? 'present' : chalk.yellow('missing — run "rnd build:configure"')}`);
  if (project.appConfig.isDynamic) {
    Log.log('');
    Log.warn(
      'This project has a dynamic app config. Values shown come from app.json; ' +
        'app.config.js is evaluated on the runner with the profile\'s env applied.'
    );
  }
  Log.log('');
}

/**
 * `eas credentials` — in EAS this opens an interactive manager over credentials
 * stored on Expo's servers. Here the signing assets are GitHub repo secrets, so
 * the honest version of this command reports which ones exist.
 */
export async function credentials({ options }) {
  const project = loadProjectContext();
  const auth = readAuth();
  if (!auth?.token) {
    die('Not logged in. Run "rnd login" first.');
  }
  if (!project.repo) {
    die('This project has no GitHub "origin" remote, so it has nowhere to store credentials.');
  }

  const client = new GitHubClient({ token: auth.token, repo: project.repo });
  const { secrets = [] } = await client.listSecrets();
  const names = new Set(secrets.map((s) => s.name));

  const groups = {
    ios: [
      ['EAS_IOS_DIST_P12', 'distribution certificate + private key'],
      ['EAS_IOS_P12_PASSWORD', 'password for that .p12'],
      ['EAS_IOS_PROFILE', 'App Store provisioning profile (store builds)'],
      ['EAS_IOS_PROFILE_INTERNAL', 'ad-hoc profile for internal builds (not needed with the API key below)'],
      ['EAS_ASC_KEY_ID', 'App Store Connect API key id: generates the ad-hoc profile from your devices'],
      ['EAS_ASC_ISSUER_ID', 'App Store Connect API issuer id'],
      ['EAS_ASC_API_KEY', 'the API key\'s .p8 file contents'],
    ],
    android: [
      ['EAS_ANDROID_KEYSTORE', 'release keystore'],
      ['EAS_ANDROID_STORE_PASSWORD', 'keystore password'],
      ['EAS_ANDROID_KEY_ALIAS', 'key alias'],
      ['EAS_ANDROID_KEY_PASSWORD', 'key password'],
    ],
  };

  const platforms = options.platform ? [options.platform] : ['ios', 'android'];
  // Not a platform, but reported alongside: without it internal builds stay
  // GitHub artifacts and no QR code can install them.
  groups.install = [['EAS_INSTALL_TOKEN', 'upload token for the install service (with the EAS_INSTALL_URL variable)']];
  if (!options.platform) platforms.push('install');
  Log.log('');
  Log.log(chalk.bold(`Credentials in ${project.repo}`));
  for (const platform of platforms) {
    Log.log('');
    Log.log(`  ${chalk.bold(platform)}`);
    for (const [name, description] of groups[platform]) {
      const present = names.has(name);
      Log.log(
        `    ${present ? chalk.green('✔') : chalk.red('✖')} ${name.padEnd(28)} ${chalk.dim(description)}`
      );
    }
  }
  Log.log('');
  Log.log(chalk.dim('  Secrets are sealed against the repo public key; GitHub never sees a plaintext value.'));
  Log.log(chalk.dim('  iOS signing assets are issued through "asc signing" — see "asc signing --help".'));
  Log.log('');
}

export async function accountView() {
  const auth = readAuth();
  if (!auth?.token) {
    die('Not logged in. Run "rnd login".');
  }
  const client = new GitHubClient({ token: auth.token, repo: null });
  const user = await client.verifyToken();
  Log.log(`${user.login}${user.name ? chalk.dim(` (${user.name})`) : ''}`);
  Log.log(chalk.dim(`  token source: ${auth.source}`));
  Log.log(chalk.dim(`  scopes: ${user.scopes.join(', ') || '(fine-grained token)'}`));
}

/**
 * Logging in means storing a GitHub token, since GitHub is what runs the builds.
 * The scope check is up front: discovering a missing `workflow` scope at
 * `build:configure` time, after setup has already written files, is worse.
 */
export async function accountLogin({ options }) {
  if (options.sso || options.browser === true) {
    Log.log('This replacement authenticates against GitHub, not Expo, so there is no SSO or browser flow.');
  }
  const token = process.env.EAS_GITHUB_TOKEN ?? (await promptSecret('GitHub personal access token: '));
  if (!token) {
    die('No token provided.');
  }

  const client = new GitHubClient({ token, repo: null });
  let user;
  try {
    user = await client.verifyToken();
  } catch (err) {
    die(`That token was rejected by GitHub: ${err.message}`);
  }

  const classic = user.scopes.length > 0;
  if (classic && !user.scopes.includes('repo')) {
    die('That token is missing the "repo" scope, so it cannot read your repository or its secrets.');
  }
  if (classic && !user.scopes.includes('workflow')) {
    Log.warn(
      'That token has no "workflow" scope. Everything works except writing ' +
        '.github/workflows/eas-build.yml through the API — you can still commit it yourself.'
    );
  }

  saveToken(token, user.login);
  Log.succeed(`Logged in as ${user.login}`);
  Log.log(chalk.dim(`  stored at ~/.eas-gh/auth.json (mode 0600)`));
}

export async function accountLogout() {
  clearToken();
  Log.succeed('Logged out.');
  if (process.env.EAS_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    Log.warn('A token is still set in your environment and will continue to be used.');
  }
}

/** Reads a secret without echoing it, so a token never lands in scrollback. */
async function promptSecret(question) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData);
      }
    };
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    if (rl.output?.isTTY) {
      // Suppress echo for the token itself.
      rl._writeToOutput = () => {};
    }
  });
}

export { link };
