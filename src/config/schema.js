import { validateStorageConfig } from '../storage/index.js';
import { validateHost } from './host.js';

const AWS_REQUIRED_FIELDS = {
  'aws.region': 'string',
  'aws.instanceType': 'string',
  'aws.keyPairName': 'string',
  'aws.securityGroupName': 'string',
  'aws.nodeVersion': 'string',
  'aws.xcodeVersion': 'string',
};

const COMMON_REQUIRED_FIELDS = {
  'repo.url': 'string',
  'repo.branch': 'string',
};

const VALID_BUILD_TYPES = ['expo', 'classic'];
const VALID_BUILD_CONFIGS = ['Debug', 'Release'];

function getNestedValue(obj, path) {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function checkRequired(config, fields, errors) {
  for (const [path, type] of Object.entries(fields)) {
    const value = getNestedValue(config, path);
    if (value === undefined || value === null || value === '') {
      errors.push(`Missing required field: ${path}`);
    } else if (typeof value !== type) {
      errors.push(`${path} must be a ${type}, got ${typeof value}`);
    }
  }
}

export function validateConfig(config) {
  const errors = [];

  for (const e of validateHost(config.host)) errors.push(e);

  checkRequired(config, COMMON_REQUIRED_FIELDS, errors);
  if (config.host?.kind === 'aws') {
    checkRequired(config, AWS_REQUIRED_FIELDS, errors);
  }

  // asc credentials are no longer required in config — they live in macOS keychain
  // via "rn-deploy credentials configure". We only validate them at build/submit time.

  if (config.storage) {
    for (const e of validateStorageConfig(config.storage)) errors.push(e);
  }

  if (config.build) {
    for (const [profileName, profile] of Object.entries(config.build)) {
      if (profile.buildType && !VALID_BUILD_TYPES.includes(profile.buildType)) {
        errors.push(
          `build.${profileName}.buildType must be one of: ${VALID_BUILD_TYPES.join(', ')}`
        );
      }
      if (profile.buildConfiguration && !VALID_BUILD_CONFIGS.includes(profile.buildConfiguration)) {
        errors.push(
          `build.${profileName}.buildConfiguration must be one of: ${VALID_BUILD_CONFIGS.join(', ')}`
        );
      }
    }
  }

  return errors;
}
