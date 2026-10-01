export const CONFIG_FILE = 'rn-build.config.json';

export const WORKFLOW_PATH = '.github/workflows/rn-build.yml';
export const WORKFLOW_FILE = 'rn-build.yml';

export const SECRET_NAMES = {
  ios: {
    p12: 'RN_BUILD_IOS_DIST_P12',
    p12Password: 'RN_BUILD_IOS_P12_PASSWORD',
    profile: 'RN_BUILD_IOS_PROFILE',
  },
  android: {
    keystore: 'RN_BUILD_ANDROID_KEYSTORE',
    storePassword: 'RN_BUILD_ANDROID_STORE_PASSWORD',
    keyAlias: 'RN_BUILD_ANDROID_KEY_ALIAS',
    keyPassword: 'RN_BUILD_ANDROID_KEY_PASSWORD',
  },
};

const VALID_PLATFORMS = ['ios', 'android', 'all'];
const VALID_BUILD_TYPES = ['expo', 'classic'];
const VALID_DISTRIBUTIONS = ['app-store', 'ad-hoc', 'development'];
const VALID_CONFIGURATIONS = ['Debug', 'Release'];

function get(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

const REQUIRED = {
  'github.repo': 'string',
  'github.ref': 'string',
};

export function validateConfig(config) {
  const errors = [];

  for (const [path, type] of Object.entries(REQUIRED)) {
    const value = get(config, path);
    if (value === undefined || value === null || value === '') {
      errors.push(`Missing required field: ${path}`);
    } else if (typeof value !== type) {
      errors.push(`${path} must be a ${type}, got ${typeof value}`);
    }
  }

  if (config.github?.repo && !config.github.repo.includes('/')) {
    errors.push(`github.repo must be "owner/name", got "${config.github.repo}"`);
  }

  for (const [name, profile] of Object.entries(config.build || {})) {
    const where = `build.${name}`;
    if (profile.platform && !VALID_PLATFORMS.includes(profile.platform)) {
      errors.push(`${where}.platform must be one of: ${VALID_PLATFORMS.join(', ')}`);
    }
    if (profile.buildType && !VALID_BUILD_TYPES.includes(profile.buildType)) {
      errors.push(`${where}.buildType must be one of: ${VALID_BUILD_TYPES.join(', ')}`);
    }
    if (profile.distribution && !VALID_DISTRIBUTIONS.includes(profile.distribution)) {
      errors.push(`${where}.distribution must be one of: ${VALID_DISTRIBUTIONS.join(', ')}`);
    }
    if (profile.buildConfiguration && !VALID_CONFIGURATIONS.includes(profile.buildConfiguration)) {
      errors.push(`${where}.buildConfiguration must be one of: ${VALID_CONFIGURATIONS.join(', ')}`);
    }
  }

  // iOS builds cannot be signed without these, and the failure would otherwise
  // land eight minutes into a billed macOS run.
  const buildsIos = Object.values(config.build || {}).some(
    (p) => !p.platform || p.platform === 'all' || p.platform === 'ios'
  );
  if (buildsIos) {
    for (const field of ['bundleId', 'scheme', 'teamId', 'profileName']) {
      if (!config.ios?.[field]) {
        errors.push(`Missing ios.${field} — required for iOS builds. Run "rn-build setup".`);
      }
    }
  }

  return errors;
}

export { VALID_PLATFORMS, VALID_BUILD_TYPES, VALID_DISTRIBUTIONS };
