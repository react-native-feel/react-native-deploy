import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export function createCli() {
  const program = new Command();

  program
    .name('rn-deploy')
    .description('Build React Native iOS apps on AWS EC2 Mac and deploy to TestFlight')
    .version(pkg.version);

  // Setup
  program
    .command('setup')
    .description('Interactive first-time setup — creates deploy.config.json')
    .action(async () => {
      const { setupCommand } = await import('./commands/setup.js');
      await setupCommand();
    });

  // Build
  program
    .command('build')
    .description('Build the app on a remote EC2 Mac instance')
    .option('--repo <url>', 'Git repository URL')
    .option('--branch <name>', 'Branch to build', 'main')
    .option('--profile <name>', 'Build profile from config', 'production')
    .option('--platform <platform>', 'Target platform', 'ios')
    .option('--build-type <type>', 'Build type: expo or classic')
    .option('--scheme <name>', 'Xcode scheme')
    .option('--no-teardown', 'Keep instance alive after build')
    .option('--non-interactive', 'Skip prompts, require all flags')
    .option('--auto-submit', 'Submit to TestFlight after build')
    .option('--message <text>', 'Build description')
    .option('--resume', 'Reconnect to in-progress build')
    .option('--timeout <minutes>', 'Build timeout in minutes', '60')
    .action(async (options) => {
      const { buildCommand } = await import('./commands/build.js');
      await buildCommand({
        ...options,
        timeout: parseInt(options.timeout, 10),
      });
    });

  // Submit
  program
    .command('submit')
    .description('Submit an .ipa to TestFlight')
    .option('--ipa <path>', 'Path to .ipa file')
    .option('--profile <name>', 'Submit profile from config', 'production')
    .option('--groups <names>', 'TestFlight groups (comma-separated)')
    .option('--what-to-test <text>', '"What to Test" notes')
    .action(async (options) => {
      const { submitCommand } = await import('./commands/submit.js');
      await submitCommand(options);
    });

  // Credentials
  const credentials = program
    .command('credentials')
    .description('Manage App Store Connect credentials (stored in macOS keychain via asc)');

  credentials
    .command('configure')
    .description('Store App Store Connect API key in keychain')
    .action(async () => {
      const { credentialsConfigure } = await import('./commands/credentials.js');
      await credentialsConfigure();
    });

  credentials
    .command('status')
    .description('Show currently active credentials')
    .action(async () => {
      const { credentialsStatus } = await import('./commands/credentials.js');
      await credentialsStatus();
    });

  credentials
    .command('switch <name>')
    .description('Switch to a different asc auth profile')
    .action(async (name) => {
      const { credentialsSwitch } = await import('./commands/credentials.js');
      await credentialsSwitch(name);
    });

  credentials
    .command('logout [name]')
    .description('Remove stored credentials')
    .action(async (name) => {
      const { credentialsLogout } = await import('./commands/credentials.js');
      await credentialsLogout(name);
    });

  // Infra
  const infra = program
    .command('infra')
    .description('Manage EC2 Mac infrastructure');

  infra
    .command('up')
    .description('Provision EC2 Mac Dedicated Host and instance')
    .option('--non-interactive', 'Skip confirmation prompts')
    .action(async (options) => {
      const { infraUp } = await import('./commands/infra.js');
      await infraUp(options);
    });

  infra
    .command('down')
    .description('Terminate instance and release Dedicated Host')
    .option('--non-interactive', 'Skip confirmation prompts')
    .action(async (options) => {
      const { infraDown } = await import('./commands/infra.js');
      await infraDown(options);
    });

  infra
    .command('status')
    .description('Show current infrastructure status and cost')
    .action(async () => {
      const { infraStatus } = await import('./commands/infra.js');
      await infraStatus();
    });

  infra
    .command('ami-list')
    .description('List custom AMIs')
    .action(async () => {
      const { infraAmiList } = await import('./commands/infra.js');
      await infraAmiList();
    });

  infra
    .command('ami-delete')
    .description('Delete a custom AMI')
    .option('--ami-id <id>', 'AMI ID to delete')
    .action(async (options) => {
      const { infraAmiDelete } = await import('./commands/infra.js');
      await infraAmiDelete({ amiId: options.amiId });
    });

  infra
    .command('update-ip')
    .description('Update security group with your current IP')
    .action(async () => {
      const { infraUpdateIp } = await import('./commands/infra.js');
      await infraUpdateIp();
    });

  return program;
}
