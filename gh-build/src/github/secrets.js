import { createRequire } from 'node:module';
import { gh, parseRepo } from './api.js';
import { logger } from '../utils/logger.js';

// libsodium-wrappers ships a broken ESM entry (its .mjs imports a file that
// isn't published), so we load the working CJS build instead.
const sodium = createRequire(import.meta.url)('libsodium-wrappers');

/**
 * Repo secrets must be encrypted client-side with the repo's public key using
 * libsodium's sealed box — GitHub never accepts plaintext.
 */
export async function setRepoSecret(repoSlug, name, value) {
  const { owner, repo } = parseRepo(repoSlug);
  const publicKey = await gh.get(`/repos/${owner}/${repo}/actions/secrets/public-key`);

  await sodium.ready;
  const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const binValue = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binValue, binKey);
  const encryptedValue = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  await gh.put(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
    encrypted_value: encryptedValue,
    key_id: publicKey.key_id,
  });

  logger.debug(`secret set: ${name} (${value.length} bytes)`);
}

export async function setRepoSecrets(repoSlug, secrets) {
  const names = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (value === undefined || value === null || value === '') {
      logger.debug(`skipping empty secret ${name}`);
      continue;
    }
    await setRepoSecret(repoSlug, name, String(value));
    names.push(name);
  }
  return names;
}

export async function listRepoSecrets(repoSlug) {
  const { owner, repo } = parseRepo(repoSlug);
  const data = await gh.get(`/repos/${owner}/${repo}/actions/secrets?per_page=100`);
  return data.secrets || [];
}

export async function deleteRepoSecret(repoSlug, name) {
  const { owner, repo } = parseRepo(repoSlug);
  await gh.delete(`/repos/${owner}/${repo}/actions/secrets/${name}`);
}
