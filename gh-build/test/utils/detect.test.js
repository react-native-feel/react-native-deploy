import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectApp, isGitIgnored } from '../../src/utils/detect.js';

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rn-build-detect-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('recognises every spelling of an ignored native dir', () => {
  for (const pattern of ['ios', 'ios/', '/ios', '/ios/', '  /ios/  ']) {
    const dir = project({ '.gitignore': `node_modules/\n${pattern}\n` });
    assert.equal(isGitIgnored(dir, 'ios'), true, `pattern ${JSON.stringify(pattern)}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a commented-out pattern does not count as ignored', () => {
  const dir = project({ '.gitignore': '# /ios\n' });
  assert.equal(isGitIgnored(dir, 'ios'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('an expo project with a generated, gitignored ios/ is buildType expo', () => {
  const dir = project({
    '.gitignore': '# generated native folders\n/ios\n/android\n',
    'package.json': JSON.stringify({ name: 'appless', dependencies: { expo: '^54.0.0' } }),
    'app.json': JSON.stringify({
      expo: { name: 'AppLess', ios: { bundleIdentifier: 'com.bidah.applessosnative' } },
    }),
    'ios/AppLess.xcworkspace/contents.xcworkspacedata': '',
  });

  const app = detectApp(dir);
  assert.equal(app.buildType, 'expo');
  assert.equal(app.name, 'AppLess');
  assert.equal(app.bundleId, 'com.bidah.applessosnative');
  assert.equal(app.scheme, 'AppLess');
  rmSync(dir, { recursive: true, force: true });
});

test('a bare RN project with a committed ios/ is buildType classic', () => {
  const dir = project({
    '.gitignore': 'node_modules/\n',
    'package.json': JSON.stringify({ name: 'legacy', dependencies: { react: '19.0.0' } }),
    'ios/Legacy.xcworkspace/contents.xcworkspacedata': '',
  });

  const app = detectApp(dir);
  assert.equal(app.buildType, 'classic');
  assert.equal(app.scheme, 'Legacy');
  rmSync(dir, { recursive: true, force: true });
});

test('falls back to a sanitised app name when there is no workspace yet', () => {
  const dir = project({
    'package.json': JSON.stringify({ dependencies: { expo: '^54.0.0' } }),
    'app.json': JSON.stringify({ expo: { name: 'My Cool App!' } }),
  });
  assert.equal(detectApp(dir).scheme, 'MyCoolApp');
  rmSync(dir, { recursive: true, force: true });
});
