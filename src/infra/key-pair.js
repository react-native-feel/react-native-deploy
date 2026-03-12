import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const KEY_DIR = join(homedir(), '.rn-deploy', 'keys');

export function getKeyPairCommands(keyName, region) {
  return {
    create: `aws ec2 create-key-pair --key-name ${keyName} --region ${region} --query "KeyMaterial" --output text`,
    describe: `aws ec2 describe-key-pairs --key-names ${keyName} --region ${region} --output json`,
    delete: `aws ec2 delete-key-pair --key-name ${keyName} --region ${region}`,
  };
}

export function getPrivateKeyPath(keyName) {
  return join(KEY_DIR, `${keyName}.pem`);
}

export async function ensureKeyPair(keyName, region) {
  const keyPath = getPrivateKeyPath(keyName);
  try {
    execSync(`aws ec2 describe-key-pairs --key-names ${keyName} --region ${region} --output json`, { encoding: 'utf-8', stdio: 'pipe' });
    if (existsSync(keyPath)) {
      logger.debug(`Key pair "${keyName}" already exists`);
      return keyPath;
    }
    logger.warn(`Key pair "${keyName}" exists in AWS but private key missing locally. Recreating...`);
    execSync(`aws ec2 delete-key-pair --key-name ${keyName} --region ${region}`, { stdio: 'pipe' });
  } catch {
    // Key doesn't exist, will create
  }
  logger.info(`Creating SSH key pair "${keyName}"...`);
  mkdirSync(KEY_DIR, { recursive: true });
  const privateKey = execSync(`aws ec2 create-key-pair --key-name ${keyName} --region ${region} --query "KeyMaterial" --output text`, { encoding: 'utf-8' });
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  logger.success(`SSH key saved to ${keyPath}`);
  return keyPath;
}

export async function deleteKeyPair(keyName, region) {
  try {
    execSync(`aws ec2 delete-key-pair --key-name ${keyName} --region ${region}`, { stdio: 'pipe' });
    logger.info(`Deleted key pair "${keyName}"`);
  } catch {
    logger.debug(`Key pair "${keyName}" not found or already deleted`);
  }
}
