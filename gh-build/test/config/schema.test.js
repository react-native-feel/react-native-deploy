import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../../src/config/schema.js';

const valid = {
  github: { repo: 'me/app', ref: 'main' },
  ios: { bundleId: 'com.me.app', scheme: 'App', teamId: 'ABCDE12345', profileName: 'App store' },
  build: { production: { platform: 'all', buildType: 'expo', distribution: 'app-store' } },
};

test('accepts a complete config', () => {
  assert.deepEqual(validateConfig(valid), []);
});

test('rejects a repo that is not owner/name', () => {
  const errors = validateConfig({ ...valid, github: { repo: 'app', ref: 'main' } });
  assert.ok(errors.some((e) => /owner\/name/.test(e)));
});

test('rejects unknown enum values', () => {
  const errors = validateConfig({
    ...valid,
    build: { production: { platform: 'web', buildType: 'flutter', distribution: 'sideload' } },
  });
  assert.equal(errors.length, 3);
});

test('requires iOS signing fields only when a profile builds iOS', () => {
  const androidOnly = {
    github: { repo: 'me/app', ref: 'main' },
    build: { production: { platform: 'android' } },
  };
  assert.deepEqual(validateConfig(androidOnly), []);

  const iosToo = { ...androidOnly, build: { production: { platform: 'all' } } };
  const errors = validateConfig(iosToo);
  assert.equal(errors.length, 4);
  assert.ok(errors.every((e) => /Missing ios\./.test(e)));
});

test('a profile with no platform defaults to building iOS', () => {
  const errors = validateConfig({
    github: { repo: 'me/app', ref: 'main' },
    build: { production: {} },
  });
  assert.ok(errors.some((e) => /Missing ios\.scheme/.test(e)));
});
