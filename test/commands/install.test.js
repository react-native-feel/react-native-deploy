import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectBuild, buildSimulatorInstallScript } from '../../src/commands/install.js';

const builds = [
  { id: 'ccc33333', version: '1.1.0', buildNumber: '5', createdAt: '2026-05-30T00:00:00Z' },
  { id: 'bbb22222', version: '1.0.0', buildNumber: '4', createdAt: '2026-05-29T00:00:00Z' },
  { id: 'aaa11111', version: '1.0.0', buildNumber: '3', createdAt: '2026-05-28T00:00:00Z' },
];

describe('selectBuild', () => {
  it('returns null for an empty list', () => {
    assert.strictEqual(selectBuild([], { latest: true }), null);
  });

  it('--latest picks the newest (first) build', () => {
    assert.strictEqual(selectBuild(builds, { latest: true }).id, 'ccc33333');
  });

  it('--id matches exact or prefix', () => {
    assert.strictEqual(selectBuild(builds, { id: 'bbb22222' }).id, 'bbb22222');
    assert.strictEqual(selectBuild(builds, { id: 'aaa' }).id, 'aaa11111');
  });

  it('--version returns the latest build of that version', () => {
    // builds are newest-first, so 1.0.0 -> build 4 (bbb), not build 3 (aaa)
    assert.strictEqual(selectBuild(builds, { version: '1.0.0' }).id, 'bbb22222');
  });

  it('returns null when no selector is given (caller should prompt)', () => {
    assert.strictEqual(selectBuild(builds, {}), null);
  });

  it('returns null when a selector matches nothing', () => {
    assert.strictEqual(selectBuild(builds, { id: 'zzz' }), null);
    assert.strictEqual(selectBuild(builds, { version: '9.9.9' }), null);
  });
});

describe('buildSimulatorInstallScript', () => {
  it('downloads, untars, installs and launches', () => {
    const s = buildSimulatorInstallScript({
      artifactUrl: 'https://cdn/app.app.tgz',
      bundleId: 'com.example.app',
    });
    assert.ok(s.includes('curl -fL "https://cdn/app.app.tgz"'));
    assert.ok(s.includes('tar -xzf app.tgz'));
    assert.ok(s.includes('xcrun simctl install booted'));
    assert.ok(s.includes('xcrun simctl launch booted "com.example.app"'));
  });

  it('omits launch when bundleId is missing', () => {
    const s = buildSimulatorInstallScript({ artifactUrl: 'https://cdn/app.app.tgz' });
    assert.ok(s.includes('simctl install booted'));
    assert.ok(!s.includes('simctl launch'));
  });

  it('honors a custom install dir', () => {
    const s = buildSimulatorInstallScript({ artifactUrl: 'u', installDir: '/tmp/x' });
    assert.ok(s.includes('mkdir -p /tmp/x'));
  });
});
