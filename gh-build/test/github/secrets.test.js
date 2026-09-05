import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const sodium = createRequire(import.meta.url)('libsodium-wrappers');

/**
 * GitHub only accepts secrets sealed against the repo's public key. If this
 * breaks, every secret we push silently becomes undecryptable server-side.
 */
test('sealed-box round-trips through the same libsodium build the CLI uses', async () => {
  await sodium.ready;
  const keys = sodium.crypto_box_keypair();
  const secret = 'p12-base64-payload';

  const sealed = sodium.crypto_box_seal(sodium.from_string(secret), keys.publicKey);
  const encoded = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

  const decoded = sodium.from_base64(encoded, sodium.base64_variants.ORIGINAL);
  const opened = sodium.crypto_box_seal_open(decoded, keys.publicKey, keys.privateKey);

  assert.equal(sodium.to_string(opened), secret);
});

test('base64 encoding uses the standard alphabet GitHub expects', async () => {
  await sodium.ready;
  const encoded = sodium.to_base64(sodium.from_string('??>>'), sodium.base64_variants.ORIGINAL);
  assert.ok(/[+/=]|^[A-Za-z0-9+/]+={0,2}$/.test(encoded));
  assert.equal(Buffer.from(encoded, 'base64').toString(), '??>>');
});
