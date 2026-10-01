const DEFAULTS = {
  platform: 'all',
  buildType: 'expo',
  buildConfiguration: 'Release',
  distribution: 'app-store',
  gradleTask: 'assembleRelease',
  androidModule: 'app',
  nodeVersion: '20',
  packageManager: 'npm',
  iosRunner: 'macos-15',
  androidRunner: 'ubuntu-latest',
  env: {},
};

/**
 * Resolves a profile's `extends` chain, nearest override winning. Cycles throw
 * rather than hanging.
 */
export function resolveProfile(profiles = {}, name, seen = new Set()) {
  const profile = profiles[name];
  if (!profile) {
    const known = Object.keys(profiles).join(', ') || '(none)';
    throw new Error(`Unknown build profile "${name}". Defined profiles: ${known}`);
  }
  if (seen.has(name)) {
    throw new Error(`Circular "extends" in build profiles: ${[...seen, name].join(' → ')}`);
  }
  seen.add(name);

  const base = profile.extends
    ? resolveProfile(profiles, profile.extends, seen)
    : DEFAULTS;

  const { extends: _ignored, ...own } = profile;
  return {
    ...base,
    ...own,
    env: { ...(base.env || {}), ...(own.env || {}) },
  };
}

export { DEFAULTS };
