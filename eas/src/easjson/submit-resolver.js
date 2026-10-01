import envString from 'env-string';

import { MissingParentProfileError, MissingProfileError } from './errors.js';
import { AndroidSubmitProfileSchema, ResolvedIosSubmitProfileSchema } from './submit-schema.js';
import {
  AndroidSubmitProfileFieldsToEvaluate,
  IosSubmitProfileFieldsToEvaluate,
  Platform,
} from './types.js';

/**
 * Submit profiles resolve differently from build profiles in two ways worth
 * knowing, because both are load-bearing for compatibility:
 *
 *   - there is no deep merge. `extends` folds the *platform block* of the parent
 *     under the child's, and that's it.
 *   - an absent profile is only fatal when the user named one. `eas submit` with
 *     no `--profile` against an eas.json that has no `submit` key still works,
 *     falling back to schema defaults.
 */
export function resolveSubmitProfile({ easJson, platform, profileName }) {
  try {
    const submitProfile = resolveProfile({
      easJson,
      platform,
      profileName: profileName ?? 'production',
    });
    const unevaluatedProfile = mergeProfiles(getDefaultProfile(platform), submitProfile);
    return evaluateFields(platform, unevaluatedProfile);
  } catch (err) {
    if (err instanceof MissingProfileError && !profileName) {
      return getDefaultProfile(platform);
    }
    throw err;
  }
}

function resolveProfile({ easJson, platform, profileName, depth = 0 }) {
  if (depth >= 5) {
    throw new Error(
      'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
    );
  }

  const profile = easJson.submit?.[profileName];
  if (!profile) {
    if (depth === 0) {
      throw new MissingProfileError(`Missing submit profile in eas.json: ${profileName}`);
    }
    throw new MissingParentProfileError(
      `Extending non-existent submit profile in eas.json: ${profileName}`
    );
  }

  const { extends: baseProfileName, ...rest } = profile;
  const platformProfile = rest[platform];
  if (baseProfileName) {
    const baseProfile = resolveProfile({
      easJson,
      platform,
      profileName: baseProfileName,
      depth: depth + 1,
    });
    return mergeProfiles(baseProfile, platformProfile);
  }
  return platformProfile;
}

function mergeProfiles(base, update) {
  if (!update) {
    return base;
  }
  return { ...base, ...update };
}

export function getDefaultProfile(platform) {
  const Schema =
    platform === Platform.ANDROID ? AndroidSubmitProfileSchema : ResolvedIosSubmitProfileSchema;
  return Schema.validate({}, { allowUnknown: false, abortEarly: false, convert: true }).value;
}

/**
 * Substitutes `$VAR` from the environment, but only in the credential-path
 * fields EAS declares. Anywhere else a literal `$` survives untouched.
 */
function evaluateFields(platform, profile) {
  const fields =
    platform === Platform.ANDROID
      ? AndroidSubmitProfileFieldsToEvaluate
      : IosSubmitProfileFieldsToEvaluate;
  const evaluated = { ...profile };
  for (const field of fields) {
    if (field in evaluated) {
      evaluated[field] = envString(evaluated[field], process.env);
    }
  }
  return evaluated;
}
