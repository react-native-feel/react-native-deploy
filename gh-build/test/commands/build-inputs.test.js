import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInputs } from '../../src/commands/build.js';
import { resolveProfile } from '../../src/config/profiles.js';

const config = {
  github: { repo: 'me/app', ref: 'main' },
  ios: { bundleId: 'com.me.app', scheme: 'MyApp', teamId: 'ABCDE12345', profileName: 'MyApp store' },
  android: { package: 'com.me.app', module: 'app' },
  build: {
    production: { platform: 'all', buildType: 'expo', env: { API_URL: 'https://api.example.com' } },
  },
};

function inputsFor(options = {}) {
  const profile = resolveProfile(config.build, 'production');
  return buildInputs({
    config,
    profile,
    profileName: 'production',
    platform: options.platform || profile.platform,
    options,
  });
}

test('every input is a string — GitHub rejects other JSON types', () => {
  for (const [key, value] of Object.entries(inputsFor())) {
    assert.equal(typeof value, 'string', `${key} should be a string`);
  }
});

test('carries iOS signing identity from config, not the profile', () => {
  const inputs = inputsFor();
  assert.equal(inputs.team_id, 'ABCDE12345');
  assert.equal(inputs.bundle_id, 'com.me.app');
  assert.equal(inputs.profile_name, 'MyApp store');
  assert.equal(inputs.scheme, 'MyApp');
});

test('profile env is serialised for the runner', () => {
  assert.deepEqual(JSON.parse(inputsFor().env_json), { API_URL: 'https://api.example.com' });
});

test('dispatch_id is unique per call so run lookup cannot collide', () => {
  assert.notEqual(inputsFor().dispatch_id, inputsFor().dispatch_id);
});

test('flags override profile values', () => {
  const inputs = inputsFor({ gradleTask: 'bundleRelease', iosRunner: 'macos-15-xlarge' });
  assert.equal(inputs.gradle_task, 'bundleRelease');
  assert.equal(inputs.ios_runner, 'macos-15-xlarge');
});
