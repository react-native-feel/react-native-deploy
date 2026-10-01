import Joi from 'joi';

import { AndroidReleaseStatus } from './types.js';

/** A port of eas-json's `submit/schema.ts`. */

export const AndroidSubmitProfileSchema = Joi.object({
  serviceAccountKeyPath: Joi.string(),
  track: Joi.string().default('internal'),
  releaseStatus: Joi.string()
    .valid(...Object.values(AndroidReleaseStatus))
    .default(AndroidReleaseStatus.completed),
  changesNotSentForReview: Joi.boolean().default(false),
  applicationId: Joi.string(),
  rollout: Joi.number().min(0).max(1).when('releaseStatus', {
    is: AndroidReleaseStatus.inProgress,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

/**
 * The lenient pass, used while reading eas.json. It has to accept `"$ASC_API_KEY_PATH"`
 * in the credential fields, because those are resolved from the environment later.
 */
export const UnresolvedIosSubmitProfileSchema = Joi.object({
  ascApiKeyPath: Joi.string(),
  ascApiKeyId: Joi.string(),
  ascApiKeyIssuerId: Joi.string(),
  appleId: Joi.string(),
  ascAppId: Joi.string(),
  appleTeamId: Joi.string(),
  sku: Joi.string(),
  language: Joi.string().default('en-US'),
  companyName: Joi.string(),
  appName: Joi.string(),
  bundleIdentifier: Joi.string(),
  metadataPath: Joi.string(),
  groups: Joi.array().items(Joi.string()),
});

/** The strict pass, applied once every `$VAR` has been substituted. */
export const ResolvedIosSubmitProfileSchema = Joi.object({
  ascApiKeyPath: Joi.string(),
  ascApiKeyId: Joi.string()
    .regex(/^[\dA-Z]+$/)
    .message(
      'Invalid Apple App Store Connect API Key ID ("ascApiKeyId") was specified. It should consist of uppercase letters or digits. Example: "AB32CZE81F". Learn more: https://expo.fyi/creating-asc-api-key.'
    )
    .max(30),
  ascApiKeyIssuerId: Joi.string()
    .uuid()
    .message(
      'Invalid Apple App Store Connect API Key Issuer ID ("ascApiKeyIssuerId") was specified. It should be a valid UUID. Example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx". Learn more: https://expo.fyi/creating-asc-api-key.'
    ),
  appleId: Joi.string()
    .email()
    .message(
      'Invalid Apple ID was specified. It should be a valid email address. Example: "name@example.com".'
    ),
  ascAppId: Joi.string()
    .regex(/^\d+$/)
    .message(
      'Invalid Apple App Store Connect App ID ("ascAppId") was specified. It should consist only of digits. Example: "1234567891". Learn more: https://expo.fyi/asc-app-id.'
    )
    .max(30),
  appleTeamId: Joi.string()
    .regex(/^[\dA-Z]{10}$/)
    .message(
      'Invalid Apple Team ID was specified. It should consist of 10 uppercase letters or digits. Example: "AB32CZE81F".'
    ),
  sku: Joi.string(),
  language: Joi.string().default('en-US'),
  companyName: Joi.string(),
  appName: Joi.string(),
  bundleIdentifier: Joi.string(),
  metadataPath: Joi.string(),
  groups: Joi.array().items(Joi.string()),
});

export const UnresolvedSubmitProfileSchema = Joi.object({
  extends: Joi.string(),
  android: AndroidSubmitProfileSchema,
  ios: UnresolvedIosSubmitProfileSchema,
});
