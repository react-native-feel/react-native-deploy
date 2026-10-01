import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE, validateConfig } from './schema.js';

export function configPath(dir = process.cwd()) {
  return join(dir, CONFIG_FILE);
}

export function configExists(dir = process.cwd()) {
  return existsSync(configPath(dir));
}

export function loadConfig(dir = process.cwd()) {
  const path = configPath(dir);
  if (!existsSync(path)) {
    throw new Error(`No ${CONFIG_FILE} in ${dir}. Run "rn-build setup" first.`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
}

export function saveConfig(config, dir = process.cwd()) {
  const path = configPath(dir);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  return path;
}

export function validateLoadedConfig(config) {
  const errors = validateConfig(config);
  if (errors.length) {
    throw new Error(`Invalid ${CONFIG_FILE}:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
