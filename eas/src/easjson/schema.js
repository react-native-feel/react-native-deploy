import Joi from 'joi';

import { BuildProfileSchema } from './build-schema.js';
import { UnresolvedSubmitProfileSchema } from './submit-schema.js';
import { AppVersionSource } from './types.js';

/**
 * The top-level eas.json shape. `allowUnknown: false` is applied at read time,
 * so anything not listed here is a hard error — same as EAS. That strictness is
 * the point: it is how a typo'd key gets caught before a billed runner starts.
 */
export const EasJsonSchema = Joi.object({
  $schema: Joi.string(),
  cli: Joi.object({
    version: Joi.string(),
    requireCommit: Joi.boolean(),
    appVersionSource: Joi.string().valid(...Object.values(AppVersionSource)),
    promptToConfigurePushNotifications: Joi.boolean(),
    updateAssetHostOverride: Joi.string(),
    updateManifestHostOverride: Joi.string(),
  }),
  build: Joi.object().pattern(Joi.string(), BuildProfileSchema),
  submit: Joi.object().pattern(Joi.string(), UnresolvedSubmitProfileSchema),
});
