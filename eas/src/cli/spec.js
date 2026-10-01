/**
 * The command surface, declared rather than hand-wired.
 *
 * Every entry mirrors a real `eas-cli` command: same id, same aliases, same flag
 * names, same short chars, same option lists, same defaults. A test compares
 * this table against `eas-cli`'s own `oclif.manifest.json`, so drift in either
 * direction is caught mechanically instead of by reading release notes.
 *
 * Scope is deliberate. EAS ships 154 commands; this covers the build, submit and
 * credentials surface — the part that has a meaning without Expo's servers. The
 * rest are listed in UNSUPPORTED below so `eas update` fails with a straight
 * answer rather than "unknown command".
 */

/** Flag shorthands, so the table below stays readable. */
const json = { name: 'json', type: 'boolean', description: 'Enable JSON output' };
const nonInteractive = {
  name: 'non-interactive',
  type: 'boolean',
  description: 'Run the command in non-interactive mode',
};
const platform = (options = ['android', 'ios', 'all']) => ({
  name: 'platform',
  char: 'p',
  type: 'option',
  options,
  description: 'Platform to build for',
});
const profile = {
  name: 'profile',
  char: 'e',
  type: 'option',
  description:
    'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
};
const offset = { name: 'offset', type: 'option', description: 'Start queries from specified index' };
const limit = { name: 'limit', type: 'option', description: 'The number of items to fetch' };

export const COMMANDS = [
  {
    id: 'build',
    description: 'start a build',
    flags: [
      platform(),
      profile,
      { name: 'local', type: 'boolean', description: 'Run build locally [experimental]' },
      { name: 'output', type: 'option', description: 'Output path for local build' },
      { name: 'wait', type: 'boolean', allowNo: true, default: true, description: 'Wait for build(s) to complete' },
      { name: 'clear-cache', type: 'boolean', description: 'Clear cache before the build' },
      {
        name: 'auto-submit',
        char: 's',
        type: 'boolean',
        aliases: ['submit'],
        description:
          'Submit on build complete using the submit profile with the same name as the build profile',
      },
      {
        name: 'auto-submit-with-profile',
        type: 'option',
        description: 'Submit on build complete using the submit profile with provided name',
      },
      {
        name: 'what-to-test',
        type: 'option',
        description:
          'Specify the "What to Test" information for the build in TestFlight (iOS-only). To be used with the `auto-submit` flag',
      },
      { name: 'message', char: 'm', type: 'option', description: 'A short message describing the build' },
      {
        name: 'build-logger-level',
        type: 'option',
        options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
        description: 'The level of logs to output during the build process. Defaults to "info".',
      },
      {
        name: 'freeze-credentials',
        type: 'boolean',
        description: 'Prevent the build from updating credentials in non-interactive mode',
      },
      {
        name: 'refresh-ad-hoc-provisioning-profile',
        type: 'boolean',
        description:
          'Refresh managed ad-hoc provisioning profiles from App Store Connect before gathering build credentials',
      },
      { name: 'verbose-logs', type: 'boolean', description: 'Use verbose logs for the build process' },
      json,
      nonInteractive,
    ],
  },
  {
    id: 'build:list',
    description: 'list all builds for your project',
    flags: [
      platform(),
      {
        name: 'status',
        type: 'option',
        options: ['new', 'in-queue', 'in-progress', 'pending-cancel', 'errored', 'finished', 'canceled'],
        description: 'Filter by build status',
      },
      {
        name: 'distribution',
        type: 'option',
        options: ['store', 'internal', 'simulator'],
        description: 'Filter by distribution type',
      },
      { name: 'channel', type: 'option' },
      { name: 'app-version', type: 'option', aliases: ['appVersion'] },
      { name: 'app-build-version', type: 'option', aliases: ['appBuildVersion'] },
      { name: 'sdk-version', type: 'option', aliases: ['sdkVersion'] },
      { name: 'runtime-version', type: 'option', aliases: ['runtimeVersion'] },
      { name: 'app-identifier', type: 'option', aliases: ['appIdentifier'] },
      { name: 'build-profile', char: 'e', type: 'option', aliases: ['profile', 'buildProfile'] },
      { name: 'git-commit-hash', type: 'option', aliases: ['gitCommitHash'] },
      { name: 'fingerprint-hash', type: 'option' },
      offset,
      limit,
      json,
      nonInteractive,
      { name: 'simulator', type: 'boolean', description: 'Filter only iOS simulator builds' },
    ],
  },
  {
    id: 'build:view',
    description: 'view a build for your project',
    args: ['BUILD_ID'],
    flags: [json],
  },
  {
    id: 'build:cancel',
    description: 'cancel a build',
    args: ['BUILD_ID'],
    flags: [nonInteractive, platform(), profile],
  },
  {
    id: 'build:download',
    description: 'download a simulator/emulator build by build ID or fingerprint hash',
    flags: [
      { name: 'build-id', type: 'option', aliases: ['id'] },
      { name: 'fingerprint', type: 'option' },
      platform(['ios', 'android']),
      { name: 'dev-client', type: 'boolean', allowNo: true },
      { name: 'all-artifacts', type: 'boolean' },
      json,
      nonInteractive,
    ],
  },
  {
    id: 'build:configure',
    description: 'configure the project to support EAS Build',
    flags: [platform()],
  },
  {
    id: 'build:version:get',
    description: 'get the latest version from EAS servers',
    flags: [platform(), profile, json, nonInteractive],
  },
  {
    id: 'build:version:set',
    description: 'update version of an app',
    flags: [platform(['android', 'ios']), profile],
  },
  {
    id: 'submit',
    aliases: ['build:submit'],
    description: 'submit app binary to App Store and/or Play Store',
    flags: [
      platform(),
      profile,
      { name: 'latest', type: 'boolean', description: 'Submit the latest build for specified platform' },
      { name: 'id', type: 'option', description: 'ID of the build to submit' },
      { name: 'path', type: 'option', description: 'Path to the .apk/.aab/.ipa file' },
      { name: 'url', type: 'option', description: 'App archive url' },
      {
        name: 'what-to-test',
        type: 'option',
        description: 'Sets the "What to test" information in TestFlight (iOS only).',
      },
      { name: 'verbose', type: 'boolean', description: 'Always print logs from EAS Submit' },
      { name: 'wait', type: 'boolean', allowNo: true, default: true, description: 'Wait for submission to complete' },
      { name: 'verbose-fastlane', type: 'boolean' },
      { name: 'groups', char: 'g', type: 'option', description: 'Internal TestFlight testing groups to add the build to' },
      nonInteractive,
      { name: 'auto-testflight-setup', type: 'boolean', allowNo: true },
    ],
  },
  {
    id: 'submit:list',
    description: 'list submissions for your project',
    flags: [
      platform(),
      {
        name: 'status',
        type: 'option',
        options: ['awaiting-build', 'in-queue', 'in-progress', 'finished', 'errored', 'canceled'],
      },
      offset,
      limit,
      json,
      nonInteractive,
    ],
  },
  {
    id: 'submit:view',
    description: 'view a submission for your project',
    args: ['SUBMISSION_ID'],
    flags: [platform(), json],
  },
  {
    id: 'submit:status',
    description:
      'show the status of your app on the App Store: the live version and TestFlight builds',
    flags: [platform(), profile, json, nonInteractive],
  },
  {
    id: 'submit:cancel',
    description: 'cancel a submission',
    args: ['SUBMISSION_ID'],
    flags: [nonInteractive, platform()],
  },
  {
    id: 'credentials',
    description: 'manage credentials',
    flags: [platform(['android', 'ios'])],
  },
  {
    id: 'config',
    description: 'display project configuration (app.json + eas.json)',
    flags: [platform(['android', 'ios']), profile, json, nonInteractive],
  },
  {
    id: 'project:info',
    description: 'information about the current project',
    flags: [],
  },
  {
    id: 'device:list',
    description: 'list all registered devices for your account',
    flags: [
      { name: 'apple-team-id', type: 'option' },
      offset,
      limit,
      json,
      nonInteractive,
    ],
  },
  {
    id: 'device:create',
    description: 'register new Apple Devices to use for internal distribution',
    flags: [],
  },
  {
    id: 'account:view',
    aliases: ['whoami'],
    description: 'show the username you are logged in as',
    flags: [],
  },
  {
    id: 'account:login',
    aliases: ['login'],
    description: 'log in with your Expo account',
    flags: [
      { name: 'sso', char: 's', type: 'boolean', description: 'Log in with SSO' },
      {
        name: 'browser',
        char: 'b',
        type: 'boolean',
        allowNo: true,
        default: true,
        description: 'Log in with your browser (default; use --no-browser for CLI-based login)',
      },
    ],
  },
  {
    id: 'account:logout',
    aliases: ['logout'],
    description: 'log out',
    flags: [],
  },
];

/**
 * Commands that exist in EAS but describe hosted services with no local
 * equivalent. Naming them lets us fail with a real explanation — "eas update
 * needs an update server" — instead of pretending the command is a typo.
 */
export const UNSUPPORTED = {
  update: 'over-the-air updates require an update server; this replacement covers builds and submissions',
  'update:configure': 'over-the-air updates require an update server',
  branch: 'update branches require an update server',
  channel: 'update channels require an update server',
  'workflow:run': 'EAS Workflows run on Expo infrastructure; use GitHub Actions directly',
  webhook: 'EAS webhooks are emitted by Expo servers; use GitHub Actions webhooks',
  env: 'EAS environment variables live on Expo servers; use GitHub Actions secrets and variables',
  secret: 'EAS secrets live on Expo servers; use GitHub Actions secrets',
  metadata: 'store metadata is handled by `asc metadata` in this replacement',
  'deploy': 'EAS Hosting deployments are an Expo service',
};

export function findCommand(id) {
  return COMMANDS.find((c) => c.id === id || (c.aliases ?? []).includes(id));
}

/** Every invocable name, ids and aliases alike. */
export function allCommandNames() {
  return COMMANDS.flatMap((c) => [c.id, ...(c.aliases ?? [])]).sort();
}
