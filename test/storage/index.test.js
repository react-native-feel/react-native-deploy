import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateStorageConfig, createStorageAdapter } from '../../src/storage/index.js';

describe('validateStorageConfig', () => {
  it('returns no errors when storage is null/undefined', () => {
    assert.deepStrictEqual(validateStorageConfig(null), []);
    assert.deepStrictEqual(validateStorageConfig(undefined), []);
  });

  it('rejects unknown kind', () => {
    const errs = validateStorageConfig({ kind: 'gcs', bucket: 'x', publicBaseUrl: 'https://x.com' });
    assert.ok(errs.some(e => e.includes('kind must be')));
  });

  it('requires bucket and publicBaseUrl for r2', () => {
    const errs = validateStorageConfig({ kind: 'r2', accountId: 'acc' });
    assert.ok(errs.some(e => e.includes('bucket')));
    assert.ok(errs.some(e => e.includes('publicBaseUrl')));
  });

  it('requires accountId for r2', () => {
    const errs = validateStorageConfig({ kind: 'r2', bucket: 'b', publicBaseUrl: 'https://x.com' });
    assert.ok(errs.some(e => e.includes('accountId')));
  });

  it('requires region for s3', () => {
    const errs = validateStorageConfig({ kind: 's3', bucket: 'b', publicBaseUrl: 'https://x.com' });
    assert.ok(errs.some(e => e.includes('region')));
  });

  it('accepts a complete r2 config', () => {
    const errs = validateStorageConfig({
      kind: 'r2',
      accountId: 'acc',
      bucket: 'b',
      publicBaseUrl: 'https://x.com',
    });
    assert.deepStrictEqual(errs, []);
  });
});

describe('createStorageAdapter', () => {
  it('throws helpfully when no storage configured', () => {
    assert.throws(() => createStorageAdapter(null), /not configured/);
    assert.throws(() => createStorageAdapter({}), /not configured/);
  });

  it('throws on unknown kind', () => {
    assert.throws(
      () => createStorageAdapter({ kind: 'gcs', bucket: 'b', publicBaseUrl: 'https://x.com' }),
      /Unknown storage kind/
    );
  });

  it('builds an r2 adapter with publicUrlFor', () => {
    const adapter = createStorageAdapter({
      kind: 'r2',
      accountId: 'acc',
      bucket: 'b',
      publicBaseUrl: 'https://cdn.example.com/',
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
    });
    assert.strictEqual(adapter.bucket, 'b');
    assert.strictEqual(adapter.publicUrlFor('builds/abc/app.ipa'), 'https://cdn.example.com/builds/abc/app.ipa');
    assert.strictEqual(adapter.publicUrlFor('/leading/slash'), 'https://cdn.example.com/leading/slash');
  });

  it('builds a remote upload command that exports creds and points at the R2 endpoint', () => {
    const adapter = createStorageAdapter({
      kind: 'r2',
      accountId: 'acc123',
      bucket: 'mybucket',
      publicBaseUrl: 'https://cdn.example.com',
      accessKeyId: 'AKIA-test',
      secretAccessKey: 'secret-test',
    });
    const cmd = adapter.remoteUploadCommand('/tmp/build/app.ipa', 'builds/abc/app.ipa');
    assert.ok(cmd.includes('AWS_ACCESS_KEY_ID="AKIA-test"'));
    assert.ok(cmd.includes('AWS_SECRET_ACCESS_KEY="secret-test"'));
    assert.ok(cmd.includes('aws s3 cp'));
    assert.ok(cmd.includes('s3://mybucket/builds/abc/app.ipa'));
    assert.ok(cmd.includes('https://acc123.r2.cloudflarestorage.com'));
    assert.ok(cmd.includes('--content-type "application/octet-stream"'));
  });
});
