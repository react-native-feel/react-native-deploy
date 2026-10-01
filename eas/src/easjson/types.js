/**
 * The enum values EAS uses inside eas.json. These are string constants rather
 * than TypeScript enums, but the wire values are identical, because they are
 * what a user's committed eas.json actually contains.
 */

export const Platform = {
  ANDROID: 'android',
  IOS: 'ios',
};

export const CredentialsSource = {
  LOCAL: 'local',
  REMOTE: 'remote',
};

export const AppVersionSource = {
  LOCAL: 'local',
  REMOTE: 'remote',
};

export const ResourceClass = {
  DEFAULT: 'default',
  LARGE: 'large',
  /** @deprecated use M_MEDIUM instead */
  M1_MEDIUM: 'm1-medium',
  MEDIUM: 'medium',
  M_MEDIUM: 'm-medium',
  /** @deprecated use LARGE instead */
  M_LARGE: 'm-large',
};

export const DistributionType = {
  STORE: 'store',
  INTERNAL: 'internal',
};

export const AndroidReleaseStatus = {
  completed: 'completed',
  draft: 'draft',
  halted: 'halted',
  inProgress: 'inProgress',
};

export const AndroidBuildType = {
  APK: 'apk',
  APP_BUNDLE: 'app-bundle',
};

/**
 * Submit profile fields that support the `$SOME_ENV_VAR` indirection. EAS
 * evaluates exactly these and no others, so a `$VAR` anywhere else is passed
 * through literally.
 */
export const AndroidSubmitProfileFieldsToEvaluate = ['serviceAccountKeyPath'];
export const IosSubmitProfileFieldsToEvaluate = [
  'ascApiKeyPath',
  'ascApiKeyIssuerId',
  'ascApiKeyId',
];
