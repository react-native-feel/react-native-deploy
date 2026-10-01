import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export function createCli() {
  const program = new Command();

  program
    .name('rn-build')
    .description(
      'Run React Native iOS and Android builds on GitHub Actions runners, ' +
      'billed to your own GitHub account.'
    )
    .version(pkg.version);

  // ── auth ──────────────────────────────────────────────────────────────────
  program
    .command('login')
    .description('Store a GitHub personal access token (needs repo + workflow scopes)')
    .option('--token <token>', 'Token to store instead of prompting')
    .action(async (options) => {
      const { loginCommand } = await import('./commands/login.js');
      await loginCommand(options);
    });

  program
    .command('logout')
    .description('Remove the stored GitHub token')
    .action(async () => {
      const { logoutCommand } = await import('./commands/login.js');
      await logoutCommand();
    });

  program
    .command('whoami')
    .description('Show which GitHub account the stored token belongs to')
    .action(async () => {
      const { whoamiCommand } = await import('./commands/login.js');
      await whoamiCommand();
    });

  // ── setup ─────────────────────────────────────────────────────────────────
  program
    .command('setup')
    .description('Interactive setup — signing assets, repo secrets, workflow, config')
    .option('--repo <owner/name>', 'GitHub repository')
    .option('--ref <branch>', 'Branch to build from')
    .option('--platform <platform>', 'ios | android | all')
    .action(async (options) => {
      const { setupCommand } = await import('./commands/setup.js');
      await setupCommand(options);
    });

  // ── build ─────────────────────────────────────────────────────────────────
  program
    .command('build')
    .description('Dispatch a build on GitHub Actions, follow it, download the artifact')
    .option('--profile <name>', 'Build profile from config', 'production')
    .option('--platform <platform>', 'Override profile platform: ios | android | all')
    .option('--ref <branch>', 'Branch or tag to build')
    .option('--gradle-task <task>', 'Override Gradle task (assembleRelease, bundleRelease…)')
    .option('--ios-runner <label>', 'Override the macOS runner label')
    .option('--android-runner <label>', 'Override the Ubuntu runner label')
    .option('--output <dir>', 'Where to save artifacts', undefined)
    .option('--detach', 'Dispatch and exit without waiting')
    .action(async (options) => {
      const { buildCommand } = await import('./commands/build.js');
      await buildCommand(options);
    });

  program
    .command('status')
    .description('Show the last dispatched run (or --run <id>)')
    .option('--run <id>', 'Specific run id')
    .option('--watch', 'Follow until it finishes, then download artifacts')
    .option('--download', 'Download artifacts if the run already succeeded')
    .option('--output <dir>', 'Where to save artifacts')
    .action(async (options) => {
      const { statusCommand } = await import('./commands/build.js');
      await statusCommand(options);
    });

  program
    .command('cancel')
    .description('Cancel the last dispatched run to stop billing')
    .option('--run <id>', 'Specific run id')
    .action(async (options) => {
      const { cancelCommand } = await import('./commands/build.js');
      await cancelCommand(options);
    });

  // ── workflow ──────────────────────────────────────────────────────────────
  const workflow = program
    .command('workflow')
    .description('Manage the .github/workflows/rn-build.yml file');

  workflow
    .command('init')
    .description('Write the workflow into the local checkout')
    .option('--push', 'Also commit it to the configured branch')
    .option('-y, --yes', 'Skip the confirmation prompt when pushing')
    .action(async (options) => {
      const { workflowInitCommand } = await import('./commands/workflow.js');
      await workflowInitCommand(options);
    });

  workflow
    .command('push')
    .description('Commit the workflow to the configured branch via the GitHub API')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (options) => {
      const { workflowPushCommand } = await import('./commands/workflow.js');
      await workflowPushCommand(options);
    });

  // ── credentials ───────────────────────────────────────────────────────────
  const credentials = program
    .command('credentials')
    .description('Inspect and rotate signing assets');

  credentials
    .command('list')
    .description('Show which signing secrets the repo has')
    .action(async () => {
      const { credentialsListCommand } = await import('./commands/credentials.js');
      await credentialsListCommand();
    });

  credentials
    .command('rotate-ios')
    .description('Create a fresh iOS certificate + profile and update the secrets')
    .option('--distribution <type>', 'app-store | ad-hoc | development', 'app-store')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      const { credentialsRotateIosCommand } = await import('./commands/credentials.js');
      await credentialsRotateIosCommand(options);
    });

  credentials
    .command('rotate-android')
    .description('Generate or import an Android keystore and update the secrets')
    .option('--import <path>', 'Import an existing .jks instead of generating one')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      const { credentialsRotateAndroidCommand } = await import('./commands/credentials.js');
      await credentialsRotateAndroidCommand(options);
    });

  credentials
    .command('clear')
    .description('Delete every rn-build signing secret from the repo')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      const { credentialsClearCommand } = await import('./commands/credentials.js');
      await credentialsClearCommand(options);
    });

  return program;
}
