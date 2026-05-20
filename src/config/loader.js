import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateConfig } from './schema.js';
import { loadFromExpoProject, findExpoProject } from './expo-loader.js';

const CONFIG_FILENAME = 'deploy.config.json';

// Loading order:
//   1) deploy.config.json present       → use it (legacy / explicit)
//   2) eas.json / app.json present       → derive config from Expo project
//   3) Both present                      → merge (deploy.config.json overlays Expo)
//   4) Neither                           → throw, suggest setup
export function loadConfig(dir = process.cwd()) {
  const root = resolve(dir);
  const configPath = join(root, CONFIG_FILENAME);
  const hasDeployConfig = existsSync(configPath);
  const expoProject = findExpoProject(root);

  let overlay = null;
  if (hasDeployConfig) {
    const raw = readFileSync(configPath, 'utf-8');
    try {
      overlay = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in ${configPath}`);
    }
    if (overlay.asc?.privateKeyPath?.startsWith('~')) {
      overlay.asc.privateKeyPath = overlay.asc.privateKeyPath.replace('~', homedir());
    }
  }

  let config;
  if (expoProject) {
    config = loadFromExpoProject(root, overlay);
  } else if (overlay) {
    config = overlay;
  } else {
    throw new Error(
      `No config found in ${root}. Expected eas.json/app.json (Expo project) or deploy.config.json. ` +
      `Run "rn-deploy setup" to create one.`
    );
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
