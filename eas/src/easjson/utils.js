import { resolveBuildProfile } from './build-resolver.js';
import { MissingEasJsonError } from './errors.js';
import { resolveSubmitProfile } from './submit-resolver.js';
import { AndroidSubmitProfileSchema, ResolvedIosSubmitProfileSchema } from './submit-schema.js';
import { Platform } from './types.js';

/**
 * The façade the CLI actually calls, mirroring `@expo/eas-json`'s `EasJsonUtils`.
 */
export class EasJsonUtils {
  static async getBuildProfileNamesAsync(accessor) {
    const easJson = await accessor.readAsync();
    return Object.keys(easJson?.build ?? {});
  }

  static async getBuildProfileAsync(accessor, platform, profileName) {
    const easJson = await accessor.readAsync();
    return resolveBuildProfile({ easJson, platform, profileName });
  }

  static async getBuildProfileDeprecationWarningsAsync(accessor, platform, profileName) {
    const warnings = [];
    const buildProfile = await EasJsonUtils.getBuildProfileAsync(accessor, platform, profileName);
    const rawEasJson = await accessor.readRawJsonAsync();

    if (buildProfile.cache?.cacheDefaultPaths !== undefined) {
      warnings.push({
        message: [
          `The "build.${profileName}.cache.cacheDefaultPaths" field in eas.json is deprecated and will be removed in the future.`,
        ],
        docsUrl: 'https://docs.expo.dev/build-reference/caching/#ios-dependencies',
      });
    }

    if (buildProfile.expoCli) {
      warnings.push({
        message: [
          `The "build.${profileName}.expoCli" field in eas.json is deprecated and will be removed in the future.`,
          `Global Expo CLI is deprecated. Since Expo SDK 46 local Expo CLI shipped with "expo" package is used. Remove this field from eas.json.`,
          `Using this field has no effect on EAS Build process.`,
        ],
      });
    }

    warnings.push(...EasJsonUtils.getCustomPathsDeprecationWarnings(rawEasJson, profileName));
    return warnings;
  }

  static getCustomPathsDeprecationWarnings(rawEasJson, profileName) {
    const warnings = [];
    if (rawEasJson.build?.[profileName]?.cache?.customPaths !== undefined) {
      warnings.push({
        message: [
          `The "build.${profileName}.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.${profileName}.cache.paths" instead.`,
        ],
        docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
      });
    }
    // The warning has to follow `extends`, because the deprecated key may live
    // on a parent profile the user never names directly.
    if (rawEasJson.build?.[profileName]?.extends !== undefined) {
      warnings.push(
        ...EasJsonUtils.getCustomPathsDeprecationWarnings(
          rawEasJson,
          rawEasJson.build[profileName].extends
        )
      );
    }
    return warnings;
  }

  static async getCliConfigAsync(accessor) {
    try {
      const easJson = await accessor.readAsync();
      return easJson.cli ?? null;
    } catch (err) {
      if (err instanceof MissingEasJsonError) {
        return null;
      }
      throw err;
    }
  }

  static async getSubmitProfileNamesAsync(accessor) {
    const easJson = await accessor.readAsync();
    return Object.keys(easJson?.submit ?? {});
  }

  static async getSubmitProfileAsync(accessor, platform, profileName) {
    const easJson = await accessor.readAsync();
    const profile = resolveSubmitProfile({ easJson, platform, profileName });
    // The resolved profile gets a second, stricter pass — this is where a
    // `$ASC_API_KEY_ID` that expanded to nothing finally gets rejected.
    const Schema =
      platform === Platform.ANDROID ? AndroidSubmitProfileSchema : ResolvedIosSubmitProfileSchema;
    const { value, error } = Schema.validate(profile, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
    });
    if (error) {
      throw error;
    }
    return value;
  }
}
