import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { logger } from '../utils/logger.js';
import { input, select, confirm } from '../utils/prompts.js';
import { verifyPrerequisites } from '../utils/prerequisites.js';
import { validateConfig } from '../config/schema.js';
import { findExpoProject } from '../config/expo-loader.js';
import { credentialsConfigure } from './credentials.js';
import { ascStatus } from '../config/credentials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_PATH = join(__dirname, '../../templates/deploy.config.json');
const CONFIG_FILENAME = 'deploy.config.json';

export async function setupCommand() {
  const projectDir = process.cwd();
  const configPath = join(projectDir, CONFIG_FILENAME);

  logger.info('rn-deploy setup');

  await verifyPrerequisites();

  // Step 1: ASC credentials — keychain via asc
  const status = ascStatus();
  if (!status.keyId) {
    logger.info('No App Store Connect credentials found.');
    const setup = await confirm('Configure them now?', true);
    if (setup) await credentialsConfigure();
  } else {
    logger.success(`Using existing asc credentials (keyId: ${status.keyId})`);
  }

  // Step 2: If this is an Expo project, eas.json/app.json drive most config
  const expoProject = findExpoProject(projectDir);
  if (expoProject) {
    logger.success('Detected Expo project — eas.json/app.json will be used for build profiles and bundleId.');
    const writeOverlay = await confirm(
      'Write a deploy.config.json overlay (for repo URL, AWS region, and signing.syncRepo)?',
      true
    );
    if (!writeOverlay) {
      logger.info('Setup complete. Run "rn-deploy build" to start.');
      return;
    }
  }

  if (existsSync(configPath)) {
    const overwrite = await confirm('deploy.config.json already exists. Overwrite?', false);
    if (!overwrite) {
      logger.info('Setup cancelled');
      return;
    }
  }

  const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8'));

  // Strip example-only keys so they never leak into a generated config.
  delete template._host_example_macincloud_;
  delete template._storage_example_r2_;

  const hostKind = await select('Where should builds run?', [
    { name: 'AWS EC2 Mac (provisioned + torn down per build)', value: 'aws' },
    { name: 'MacinCloud / existing Mac over SSH (no infra management)', value: 'macincloud' },
  ]);

  if (hostKind === 'aws') {
    template.host = { kind: 'aws' };
    template.aws.region = await select('AWS region?', [
      'us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-southeast-1',
    ]);
  } else {
    delete template.aws;
    const macHost = await input('Mac SSH host (e.g. TX0XX.macincloud.com):');
    const macUser = await input('SSH username:');
    const useKey = await confirm('Authenticate with a private key (no = password)?', false);
    template.host = {
      kind: 'macincloud',
      host: macHost,
      port: Number(await input('SSH port:', '22')),
      user: macUser,
      workDir: await input('Remote working directory:', '~/rn-deploy-work'),
    };
    if (useKey) {
      template.host.privateKey = await input('Path to private key:', '~/.ssh/id_rsa');
    } else {
      template.host.password = await input('SSH password:');
    }
  }

  template.repo.url = await input('Git repository URL:');
  template.repo.branch = await input('Default branch:', 'main');

  if (!expoProject) {
    template.build.production.scheme = await input('Xcode scheme name:');
    template.build.production.buildType = await select('Build type?', [
      { name: 'Expo (expo prebuild + xcodebuild)', value: 'expo' },
      { name: 'Classic (xcodebuild directly)', value: 'classic' },
    ]);
  } else {
    // Expo loader supplies build profiles — remove placeholder
    delete template.build;
    delete template.submit;
  }

  // Drop the legacy asc plaintext block — creds live in keychain now
  delete template.asc;

  const wantSync = await confirm('Configure a signing sync repo (asc signing sync)?', false);
  if (wantSync) {
    template.signing = template.signing || {};
    template.signing.syncRepo = await input('Git repo URL for encrypted signing assets:');
  }

  const errors = validateConfig(template);
  if (errors.length > 0) {
    logger.error('Config validation failed:');
    errors.forEach(e => logger.error(`  - ${e}`));
    return;
  }

  writeFileSync(configPath, JSON.stringify(template, null, 2) + '\n');
  logger.success(`Config saved to ${configPath}`);
  logger.info('Run "rn-deploy build" to start your first build');
}
