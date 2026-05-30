import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeHost, validateHost, HOST_KINDS } from '../../src/config/host.js';

describe('normalizeHost', () => {
  it('synthesizes aws host from legacy aws-only config', () => {
    const config = { aws: { region: 'us-east-1' } };
    normalizeHost(config);
    assert.deepStrictEqual(config.host, { kind: 'aws' });
  });

  it('leaves existing host block untouched (aws kind)', () => {
    const config = { host: { kind: 'aws' }, aws: { region: 'us-east-1' } };
    normalizeHost(config);
    assert.strictEqual(config.host.kind, 'aws');
  });

  it('fills macincloud defaults', () => {
    const config = {
      host: { kind: 'macincloud', host: 'h', user: 'u', password: 'p' },
    };
    normalizeHost(config);
    assert.strictEqual(config.host.port, 22);
    assert.strictEqual(config.host.workDir, '~/rn-deploy-work');
  });

  it('does not overwrite explicit macincloud port/workDir', () => {
    const config = {
      host: {
        kind: 'macincloud',
        host: 'h',
        user: 'u',
        password: 'p',
        port: 2222,
        workDir: '/tmp/work',
      },
    };
    normalizeHost(config);
    assert.strictEqual(config.host.port, 2222);
    assert.strictEqual(config.host.workDir, '/tmp/work');
  });

  it('expands ~ in privateKey path', () => {
    const config = {
      host: { kind: 'macincloud', host: 'h', user: 'u', privateKey: '~/.ssh/foo' },
    };
    normalizeHost(config);
    assert.ok(!config.host.privateKey.startsWith('~'));
  });

  it('leaves host null when neither block present', () => {
    const config = {};
    normalizeHost(config);
    assert.strictEqual(config.host, null);
  });

  it('interpolates ${ENV} references from process.env', () => {
    process.env.__TEST_MAC_PW = 's3cret';
    const config = {
      host: { kind: 'macincloud', host: 'h', user: 'u', password: '${__TEST_MAC_PW}' },
    };
    normalizeHost(config);
    assert.strictEqual(config.host.password, 's3cret');
    delete process.env.__TEST_MAC_PW;
  });

  it('throws when an interpolated env var is missing', () => {
    const config = {
      host: { kind: 'macincloud', host: 'h', user: 'u', password: '${__TEST_MISSING_VAR}' },
    };
    assert.throws(() => normalizeHost(config), /env var __TEST_MISSING_VAR is not set/);
  });
});

describe('validateHost', () => {
  it('rejects missing host', () => {
    const errors = validateHost(null);
    assert.ok(errors.some(e => e.includes('Missing required block: host')));
  });

  it('rejects missing kind', () => {
    const errors = validateHost({});
    assert.ok(errors.some(e => e.includes('host.kind is required')));
  });

  it('rejects unknown kind', () => {
    const errors = validateHost({ kind: 'gcp' });
    assert.ok(errors.some(e => e.includes('host.kind must be one of')));
  });

  it('accepts aws kind with no extra fields', () => {
    assert.deepStrictEqual(validateHost({ kind: 'aws' }), []);
  });

  it('rejects macincloud missing host/user/credential', () => {
    const errors = validateHost({ kind: 'macincloud' });
    assert.ok(errors.some(e => e.includes('host.host is required')));
    assert.ok(errors.some(e => e.includes('host.user is required')));
    assert.ok(errors.some(e => e.includes('host.password or host.privateKey')));
  });

  it('accepts macincloud with password', () => {
    const errors = validateHost({
      kind: 'macincloud',
      host: 'TX0XX.macincloud.com',
      user: 'user',
      password: 'pass',
    });
    assert.deepStrictEqual(errors, []);
  });

  it('accepts macincloud with privateKey', () => {
    const errors = validateHost({
      kind: 'macincloud',
      host: 'TX0XX.macincloud.com',
      user: 'user',
      privateKey: '/keys/id_rsa',
    });
    assert.deepStrictEqual(errors, []);
  });

  it('rejects non-numeric port', () => {
    const errors = validateHost({
      kind: 'macincloud',
      host: 'h',
      user: 'u',
      password: 'p',
      port: '22',
    });
    assert.ok(errors.some(e => e.includes('host.port must be a number')));
  });

  it('exports the supported kinds', () => {
    assert.ok(HOST_KINDS.includes('aws'));
    assert.ok(HOST_KINDS.includes('macincloud'));
  });
});
