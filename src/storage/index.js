import { createR2Adapter } from './r2.js';

export function createStorageAdapter(config) {
  if (!config || !config.kind) {
    throw new Error(
      'Storage not configured. Add a "storage" block to deploy.config.json. ' +
      'See https://docs.rn-deploy.dev/distribution.'
    );
  }
  if (config.kind === 'r2') return createR2Adapter(config);
  if (config.kind === 's3') return createR2Adapter({ ...config, _flavor: 's3' });
  throw new Error(`Unknown storage kind: ${config.kind}. Supported: r2, s3.`);
}

export function validateStorageConfig(config) {
  const errors = [];
  if (!config) return errors;
  if (!['r2', 's3'].includes(config.kind)) {
    errors.push(`storage.kind must be "r2" or "s3", got "${config.kind}"`);
  }
  if (!config.bucket) errors.push('storage.bucket is required');
  if (!config.publicBaseUrl) errors.push('storage.publicBaseUrl is required (the HTTPS URL prefix the IPA will be served from)');
  if (config.kind === 'r2' && !config.accountId) {
    errors.push('storage.accountId is required for kind="r2"');
  }
  if (config.kind === 's3' && !config.region) {
    errors.push('storage.region is required for kind="s3"');
  }
  return errors;
}
