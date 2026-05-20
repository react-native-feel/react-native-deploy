import { existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { input, confirm } from '../utils/prompts.js';
import {
  ascStatus,
  ascAuthLogin,
  ascAuthLogout,
  ascAuthSwitch,
  resolveAscCredentials,
  expandHome,
} from '../config/credentials.js';

export async function credentialsConfigure() {
  logger.info('Configure App Store Connect credentials (stored in macOS keychain via asc)');

  const status = ascStatus();
  if (!status.available) {
    throw new Error('asc CLI not installed. Install with: brew install asc');
  }

  if (status.keyId && status.issuerId) {
    logger.info(`Existing credentials found for key ${status.keyId}`);
    const replace = await confirm('Replace with new credentials?', false);
    if (!replace) return;
  }

  const name = await input('Friendly name for this key:', 'rn-deploy');
  const keyId = await input('App Store Connect API Key ID:');
  const issuerId = await input('App Store Connect Issuer ID:');
  const privateKeyPath = await input(
    'Path to .p8 private key:',
    `~/.appstoreconnect/AuthKey_${keyId}.p8`
  );

  const expanded = expandHome(privateKeyPath);
  if (!existsSync(expanded)) {
    throw new Error(`.p8 file not found at ${expanded}`);
  }

  ascAuthLogin({ name, keyId, issuerId, privateKeyPath: expanded, network: true });
  logger.success(`Credentials stored in macOS keychain under profile "${name}"`);
  logger.info('Build/submit commands will pick them up automatically.');
}

export async function credentialsStatus() {
  const status = ascStatus();
  if (!status.available) {
    logger.error('asc CLI not installed. Install: brew install asc');
    return;
  }
  if (!status.keyId) {
    logger.warn('No credentials configured. Run: rn-deploy credentials configure');
    return;
  }
  logger.info(`Active profile: ${status.profile || status.name || '(default)'}`);
  logger.info(`Key ID:         ${status.keyId}`);
  logger.info(`Issuer ID:      ${status.issuerId}`);

  try {
    const resolved = resolveAscCredentials({});
    logger.success(`Resolution source: ${resolved.source}`);
    logger.info(`Local .p8 path:    ${resolved.privateKeyPath}`);
  } catch (err) {
    logger.error(err.message);
  }
}

export async function credentialsLogout(name) {
  ascAuthLogout(name);
  logger.success(name ? `Removed profile "${name}"` : 'Removed default credentials');
}

export async function credentialsSwitch(name) {
  if (!name) throw new Error('Profile name required: rn-deploy credentials switch <name>');
  ascAuthSwitch(name);
  logger.success(`Switched to profile "${name}"`);
}
