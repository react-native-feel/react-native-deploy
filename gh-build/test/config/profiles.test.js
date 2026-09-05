import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, DEFAULTS } from '../../src/config/profiles.js';

const profiles = {
  production: { platform: 'all', buildConfiguration: 'Release', env: { API: 'prod' } },
  preview: { extends: 'production', distribution: 'ad-hoc', env: { API: 'staging' } },
  dev: { extends: 'preview', buildConfiguration: 'Debug' },
};

test('fills unset fields from defaults', () => {
  const p = resolveProfile(profiles, 'production');
  assert.equal(p.gradleTask, DEFAULTS.gradleTask);
  assert.equal(p.iosRunner, 'macos-15');
});

test('nearest override wins along the extends chain', () => {
  const p = resolveProfile(profiles, 'dev');
  assert.equal(p.buildConfiguration, 'Debug');
  assert.equal(p.distribution, 'ad-hoc');
  assert.equal(p.platform, 'all');
});

test('env is merged, not replaced', () => {
  const p = resolveProfile(
    { base: { env: { A: '1', B: '2' } }, child: { extends: 'base', env: { B: '3' } } },
    'child'
  );
  assert.deepEqual(p.env, { A: '1', B: '3' });
});

test('unknown profile lists what is available', () => {
  assert.throws(() => resolveProfile(profiles, 'nope'), /production, preview, dev/);
});

test('circular extends throws instead of hanging', () => {
  const cyclic = { a: { extends: 'b' }, b: { extends: 'a' } };
  assert.throws(() => resolveProfile(cyclic, 'a'), /Circular/);
});
