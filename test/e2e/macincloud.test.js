import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  E2E_ENABLED,
  missingEnv,
  R2_ENV,
  MAC_ENV,
  SMOKE_SLUG,
  writeMacincloudConfig,
  makeStorage,
} from './helpers.js';
import { readIndex } from '../../src/distribute/registry.js';

const execFileP = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../bin/rn-deploy.js');

// Real end-to-end: build a fresh Expo app on a MacinCloud host, publish the
// simulator .app to R2, and verify it's publicly downloadable + registered.
// Gated: skips unless RN_DEPLOY_E2E=1 and the MacinCloud + R2 creds are present.
const missing = [...missingEnv(R2_ENV), ...missingEnv(MAC_ENV)];
const skip = !E2E_ENABLED || missing.length > 0;
const skipReason = !E2E_ENABLED
  ? 'RN_DEPLOY_E2E!=1'
  : `missing env: ${missing.join(', ')}`;

describe('E2E: MacinCloud simulator build', { skip: skip && skipReason }, () => {
  let latest;

  before(async () => {
    const dir = writeMacincloudConfig();
    // The build clones + compiles on the remote Mac — allow plenty of time.
    await execFileP('node', [BIN, 'build', '--profile', 'preview', '--non-interactive', '--no-teardown'], {
      cwd: dir,
      env: process.env,
      timeout: 30 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });

    const storage = await makeStorage();
    const builds = await readIndex(storage, SMOKE_SLUG);
    latest = builds[0];
  }, { timeout: 31 * 60 * 1000 });

  it('registers the build in the per-app index', () => {
    assert.ok(latest, 'expected at least one build in the registry');
    assert.strictEqual(latest.artifactKind, 'simulator-app');
    assert.strictEqual(latest.distribution, 'simulator');
    assert.ok(latest.artifactUrl, 'build record has an artifactUrl');
  });

  it('serves the .app tarball publicly (gzip)', async () => {
    const res = await fetch(latest.artifactUrl);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000, `artifact should be non-trivial, got ${buf.length} bytes`);
    // gzip magic bytes
    assert.strictEqual(buf[0], 0x1f);
    assert.strictEqual(buf[1], 0x8b);
  });

  it('serves an install page with simctl instructions', async () => {
    const res = await fetch(latest.installPageUrl);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('simctl install'), 'install page mentions simctl install');
  });
});
