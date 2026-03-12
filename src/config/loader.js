import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateConfig } from './schema.js';

const CONFIG_FILENAME = 'deploy.config.json';

export function loadConfig(dir = process.cwd()) {
  const configPath = join(resolve(dir), CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    throw new Error(
      `deploy.config.json not found in ${dir}. Run "rn-deploy setup" to create one.`
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  // Expand ~ in privateKeyPath
  if (config.asc?.privateKeyPath?.startsWith('~')) {
    config.asc.privateKeyPath = config.asc.privateKeyPath.replace('~', homedir());
  }

  return config;
}

export function mergeWithFlags(config, flags) {
  const merged = JSON.parse(JSON.stringify(config));

  if (flags.repo) merged.repo.url = flags.repo;
  if (flags.branch) merged.repo.branch = flags.branch;
  if (flags.region) merged.aws.region = flags.region;
  if (flags.scheme) {
    merged._flagOverrides = merged._flagOverrides || {};
    merged._flagOverrides.scheme = flags.scheme;
  }
  if (flags.buildType) {
    merged._flagOverrides = merged._flagOverrides || {};
    merged._flagOverrides.buildType = flags.buildType;
  }

  return merged;
}

export function validateLoadedConfig(config) {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(
      `Config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
}
