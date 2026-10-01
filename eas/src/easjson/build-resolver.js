import { BuildProfileSchema } from './build-schema.js';
import { MissingParentProfileError, MissingProfileError } from './errors.js';

/**
 * Flattens a build profile the way EAS does, in three layers:
 *
 *   1. walk the `extends` chain, nearest override winning;
 *   2. fold the platform-specific block (`ios` / `android`) over the base;
 *   3. fill anything still unset from the schema defaults.
 *
 * Getting the order right matters. A profile that sets `distribution: "internal"`
 * at the top level and nothing under `ios` still produces an internal iOS build —
 * but only because step 2 merges rather than replaces.
 */
export function resolveBuildProfile({ easJson, platform, profileName }) {
  const easJsonProfile = resolveProfile({
    easJson,
    profileName: profileName ?? 'production',
  });
  const { android: _android, ios: _ios, ...base } = easJsonProfile;
  const withoutDefaults = mergeProfiles(base, easJsonProfile[platform] ?? {});
  return mergeProfiles(getDefaultProfile(platform), withoutDefaults);
}

function resolveProfile({ easJson, profileName, depth = 0 }) {
  // EAS caps the chain at five rather than tracking visited names, so a cycle
  // surfaces as "too long" rather than hanging. Same limit, same message.
  if (depth >= 5) {
    throw new Error(
      'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
    );
  }

  const profile = easJson.build?.[profileName];
  if (!profile) {
    if (depth === 0) {
      const available = Object.keys(easJson.build ?? {})
        .map((name) => `"${name}"`)
        .join(', ');
      throw new MissingProfileError(
        `Missing build profile in eas.json: "${profileName}". Available profiles: [${available}]`
      );
    }
    throw new MissingParentProfileError(
      `Extending non-existent build profile in eas.json: "${profileName}"`
    );
  }

  const { extends: baseProfileName, ...rest } = profile;
  if (baseProfileName) {
    const baseProfile = resolveProfile({
      easJson,
      profileName: baseProfileName,
      depth: depth + 1,
    });
    return mergeProfiles(baseProfile, rest);
  }
  return rest;
}

/**
 * Shallow merge, except for the three keys where replacing would lose data the
 * user clearly meant to keep: `env` and the two platform blocks merge deeply.
 */
function mergeProfiles(base, update) {
  const result = { ...base, ...update };
  if (base.env && update.env) {
    result.env = { ...base.env, ...update.env };
  }
  if (base.android && update.android) {
    result.android = mergeProfiles(base.android, update.android);
  }
  if (base.ios && update.ios) {
    result.ios = mergeProfiles(base.ios, update.ios);
  }
  return result;
}

function getDefaultProfile(platform) {
  const defaultProfile = BuildProfileSchema.validate(
    {},
    { allowUnknown: false, abortEarly: false, convert: true }
  ).value;
  const { android: _android, ios: _ios, ...base } = defaultProfile;
  return mergeProfiles(base, defaultProfile[platform] ?? {});
}

export { mergeProfiles, getDefaultProfile };
