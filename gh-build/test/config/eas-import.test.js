import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importEasProfiles } from '../../src/config/eas-import.js';

function withEas(easJson) {
  const dir = mkdtempSync(join(tmpdir(), 'rn-build-eas-'));
  if (easJson) writeFileSync(join(dir, 'eas.json'), JSON.stringify(easJson));
  return dir;
}

test('imports env for profiles that exist on both sides', () => {
  const dir = withEas({
    build: {
      production: { env: { APP_VARIANT: 'production', EXPO_PUBLIC_AUTH_URL: 'https://api' } },
      preview: { env: { APP_VARIANT: 'preview' } },
      'development-device': { env: { APP_VARIANT: 'development' } },
    },
  });
  const profiles = { production: { env: {} }, preview: { env: {} }, development: { env: {} } };

  const imported = importEasProfiles(profiles, dir);

  assert.deepEqual(imported, ['production', 'preview']);
  assert.deepEqual(profiles.production.env, {
    APP_VARIANT: 'production',
    EXPO_PUBLIC_AUTH_URL: 'https://api',
  });
  // No matching eas profile, so it is left alone rather than guessed at.
  assert.deepEqual(profiles.development.env, {});
  rmSync(dir, { recursive: true, force: true });
});

test('an existing rn-build value wins over the eas.json one', () => {
  const dir = withEas({ build: { production: { env: { API: 'from-eas' } } } });
  const profiles = { production: { env: { API: 'from-rn-build' } } };

  importEasProfiles(profiles, dir);

  assert.equal(profiles.production.env.API, 'from-rn-build');
  rmSync(dir, { recursive: true, force: true });
});

test('no eas.json, malformed eas.json, and empty env are all no-ops', () => {
  const none = withEas(null);
  assert.deepEqual(importEasProfiles({ production: { env: {} } }, none), []);
  rmSync(none, { recursive: true, force: true });

  const broken = mkdtempSync(join(tmpdir(), 'rn-build-eas-'));
  writeFileSync(join(broken, 'eas.json'), '{ not json');
  assert.deepEqual(importEasProfiles({ production: { env: {} } }, broken), []);
  rmSync(broken, { recursive: true, force: true });

  const empty = withEas({ build: { production: { channel: 'production' } } });
  assert.deepEqual(importEasProfiles({ production: { env: {} } }, empty), []);
  rmSync(empty, { recursive: true, force: true });
});
