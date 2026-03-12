import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, mergeWithFlags } from '../../src/config/loader.js';

const TMP = join(import.meta.dirname, '../../.tmp-test');

describe('loadConfig', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('loads valid config from directory', () => {
    const config = {
      cli: { version: '1.0.0' },
      aws: { region: 'us-east-1', instanceType: 'mac2.metal', keyPairName: 'k', securityGroupName: 's', customAmiId: null, nodeVersion: '20', xcodeVersion: '16' },
      asc: { keyId: 'K', issuerId: 'I', privateKeyPath: '/key.p8' },
      repo: { url: 'git@github.com:u/a.git', branch: 'main' },
      build: { production: { buildType: 'expo', scheme: 'App', buildConfiguration: 'Release', env: {} } },
    };
    writeFileSync(join(TMP, 'deploy.config.json'), JSON.stringify(config));
    const loaded = loadConfig(TMP);
    assert.strictEqual(loaded.aws.region, 'us-east-1');
  });

  it('throws if config file not found', () => {
    assert.throws(() => loadConfig(TMP), /deploy\.config\.json not found/);
  });
});

describe('mergeWithFlags', () => {
  it('flags override config values', () => {
    const config = { repo: { url: 'old', branch: 'main' } };
    const flags = { repo: 'new-url', branch: 'dev' };
    const merged = mergeWithFlags(config, flags);
    assert.strictEqual(merged.repo.url, 'new-url');
    assert.strictEqual(merged.repo.branch, 'dev');
  });

  it('preserves config values when flags are undefined', () => {
    const config = { repo: { url: 'old', branch: 'main' } };
    const flags = {};
    const merged = mergeWithFlags(config, flags);
    assert.strictEqual(merged.repo.url, 'old');
  });
});
