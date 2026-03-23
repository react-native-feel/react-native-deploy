import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const KEY_DIR = join(homedir(), '.mac-vnc', 'keys');
const KEY_NAME = 'mac-vnc-key';

export function getPrivateKeyPath() {
  return join(KEY_DIR, `${KEY_NAME}.pem`);
}

export function ensureKeyPair(region) {
  const keyPath = getPrivateKeyPath();

  if (existsSync(keyPath)) {
    try {
      execSync(
        `aws ec2 describe-key-pairs --key-names ${KEY_NAME} --region ${region} --output json`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      logger.debug(`Key pair "${KEY_NAME}" already exists`);
      return keyPath;
    } catch {
      unlinkSync(keyPath);
    }
  }

  logger.info(`Creating key pair "${KEY_NAME}"...`);
  mkdirSync(KEY_DIR, { recursive: true });

  const result = execSync(
    `aws ec2 create-key-pair --key-name ${KEY_NAME} --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const { KeyMaterial } = JSON.parse(result);

  writeFileSync(keyPath, KeyMaterial);
  chmodSync(keyPath, 0o600);
  logger.success(`Key pair saved to ${keyPath}`);
  return keyPath;
}

export function deleteKeyPair(region) {
  try {
    execSync(
      `aws ec2 delete-key-pair --key-name ${KEY_NAME} --region ${region}`,
      { stdio: 'pipe' }
    );
  } catch { /* ignore if not found */ }

  const keyPath = getPrivateKeyPath();
  if (existsSync(keyPath)) unlinkSync(keyPath);
}
