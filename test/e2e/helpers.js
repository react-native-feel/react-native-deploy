import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const E2E_ENABLED = process.env.RN_DEPLOY_E2E === '1';

export const SMOKE_REPO_URL =
  process.env.SMOKE_REPO_URL || 'https://github.com/bidah/rn-deploy-smoke-app.git';
export const SMOKE_SCHEME = process.env.SMOKE_SCHEME || 'smokeapp';
export const SMOKE_SLUG = process.env.SMOKE_SLUG || 'smokeapp';

// Which env vars each case needs. Tests skip (not fail) when they're absent so
// the suite is safe to run anywhere; it only does real work with creds present.
export function missingEnv(names) {
  return names.filter((n) => !process.env[n]);
}

export const R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
export const MAC_ENV = ['MAC_HOST', 'MAC_USER', 'MAC_PASSWORD'];

export const R2_BUCKET = process.env.R2_BUCKET || 'react-native-deploy';
export const R2_PUBLIC_BASE_URL =
  process.env.R2_PUBLIC_BASE_URL || 'https://pub-58ef2003db8642af966d3c08e6bfdf91.r2.dev';

// Write a deploy.config.json into a fresh temp dir from env (so no secrets are
// committed). Returns the dir to run `rn-deploy build` from.
export function writeMacincloudConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'rnd-e2e-'));
  const config = {
    cli: { version: '1.0.0' },
    host: {
      kind: 'macincloud',
      host: process.env.MAC_HOST,
      user: process.env.MAC_USER,
      password: process.env.MAC_PASSWORD,
      port: Number(process.env.MAC_PORT || 22),
      workDir: '~/rn-deploy-e2e',
    },
    storage: {
      kind: 'r2',
      accountId: process.env.R2_ACCOUNT_ID,
      bucket: R2_BUCKET,
      publicBaseUrl: R2_PUBLIC_BASE_URL,
    },
    repo: { url: SMOKE_REPO_URL, branch: process.env.SMOKE_REPO_BRANCH || 'main' },
    build: {
      preview: {
        buildType: 'expo',
        scheme: SMOKE_SCHEME,
        buildConfiguration: 'Release',
        distribution: 'simulator',
        env: {},
      },
    },
    app: { slug: SMOKE_SLUG },
  };
  writeFileSync(join(dir, 'deploy.config.json'), JSON.stringify(config, null, 2));
  return dir;
}

// Build an R2 storage adapter for assertions (reads the registry, etc.).
export async function makeStorage() {
  const { createStorageAdapter } = await import('../../src/storage/index.js');
  return createStorageAdapter({
    kind: 'r2',
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: R2_BUCKET,
    publicBaseUrl: R2_PUBLIC_BASE_URL,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  });
}
