import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { logger } from '../utils/logger.js';
import { input, select, confirm } from '../utils/prompts.js';
import { verifyPrerequisites } from '../utils/prerequisites.js';
import { validateConfig } from '../config/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_PATH = join(__dirname, '../../templates/deploy.config.json');
const CONFIG_FILENAME = 'deploy.config.json';

export async function setupCommand() {
  const projectDir = process.cwd();
  const configPath = join(projectDir, CONFIG_FILENAME);

  logger.info('rn-deploy setup');

  // Check prerequisites
  await verifyPrerequisites();

  // Check if config already exists
  if (existsSync(configPath)) {
    const overwrite = await confirm('deploy.config.json already exists. Overwrite?', false);
    if (!overwrite) {
      logger.info('Setup cancelled');
      return;
    }
  }

  // Load template
  const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8'));

  // Interactive setup
  template.aws.region = await select('AWS region?', [
    'us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-southeast-1',
  ]);

  template.asc.keyId = await input('App Store Connect API Key ID:');
  template.asc.issuerId = await input('App Store Connect Issuer ID:');
  template.asc.privateKeyPath = await input(
    'Path to .p8 private key:',
    '~/.appstoreconnect/AuthKey.p8'
  );

  template.repo.url = await input('Git repository URL:');
  template.repo.branch = await input('Default branch:', 'main');

  template.build.production.scheme = await input('Xcode scheme name:');
  template.build.production.buildType = await select('Build type?', [
    { name: 'Expo (expo prebuild + xcodebuild)', value: 'expo' },
    { name: 'Classic (xcodebuild directly)', value: 'classic' },
  ]);

  // Validate
  const errors = validateConfig(template);
  if (errors.length > 0) {
    logger.error('Config validation failed:');
    errors.forEach(e => logger.error(`  - ${e}`));
    return;
  }

  // Save
  writeFileSync(configPath, JSON.stringify(template, null, 2) + '\n');
  logger.success(`Config saved to ${configPath}`);
  logger.info('Run "rn-deploy build" to start your first build');
}
