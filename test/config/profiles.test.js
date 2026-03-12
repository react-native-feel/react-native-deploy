import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveProfile } from '../../src/config/profiles.js';

describe('resolveProfile', () => {
  const profiles = {
    production: {
      buildType: 'expo',
      scheme: 'MyApp',
      buildConfiguration: 'Release',
      env: { API_URL: 'https://prod.example.com' },
    },
    preview: {
      extends: 'production',
      distribution: 'ad-hoc',
    },
    development: {
      extends: 'preview',
      buildConfiguration: 'Debug',
    },
  };

  it('returns base profile as-is', () => {
    const result = resolveProfile(profiles, 'production');
    assert.deepStrictEqual(result, profiles.production);
  });

  it('resolves single-level extends', () => {
    const result = resolveProfile(profiles, 'preview');
    assert.strictEqual(result.buildType, 'expo');
    assert.strictEqual(result.scheme, 'MyApp');
    assert.strictEqual(result.distribution, 'ad-hoc');
    assert.strictEqual(result.buildConfiguration, 'Release');
  });

  it('resolves multi-level extends', () => {
    const result = resolveProfile(profiles, 'development');
    assert.strictEqual(result.buildType, 'expo');
    assert.strictEqual(result.buildConfiguration, 'Debug');
    assert.strictEqual(result.distribution, 'ad-hoc');
  });

  it('throws on missing profile', () => {
    assert.throws(
      () => resolveProfile(profiles, 'nonexistent'),
      /Profile "nonexistent" not found/
    );
  });

  it('throws on circular extends', () => {
    const circular = {
      a: { extends: 'b' },
      b: { extends: 'a' },
    };
    assert.throws(() => resolveProfile(circular, 'a'), /Circular/);
  });

  it('throws on extends depth > 5', () => {
    const deep = {};
    for (let i = 0; i < 7; i++) {
      deep[`p${i}`] = i === 0 ? { val: true } : { extends: `p${i - 1}` };
    }
    assert.throws(() => resolveProfile(deep, 'p6'), /depth/i);
  });
});
