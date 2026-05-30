import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateInstallPage, generateSimulatorInstallPage } from '../../src/distribute/install-page.js';

describe('generateInstallPage', () => {
  const valid = {
    appTitle: 'My App',
    bundleId: 'com.example.app',
    version: '1.2.3',
    buildNumber: '42',
    commit: 'abc1234',
    profile: 'preview',
    distribution: 'ad-hoc',
    itmsServicesUrl: 'itms-services://?action=download-manifest;url=https://example.com/manifest.plist',
    ipaUrl: 'https://example.com/app.ipa',
    createdAt: '2026-05-20T12:00:00Z',
  };

  it('wraps the itms-services URL in the install button', () => {
    const html = generateInstallPage(valid);
    assert.ok(html.includes(valid.itmsServicesUrl.replace(/&/g, '&amp;').replace(/'/g, '&#39;')));
    assert.ok(html.includes('class="install-btn"'));
  });

  it('shows the app title and version', () => {
    const html = generateInstallPage(valid);
    assert.ok(html.includes('My App'));
    assert.ok(html.includes('1.2.3'));
    assert.ok(html.includes('(42)'));
  });

  it('detects non-iOS clients via the inline script and toggles a class', () => {
    const html = generateInstallPage(valid);
    assert.ok(html.includes('iPhone|iPad|iPod'));
    assert.ok(html.includes("classList.add('not-ios')"));
  });

  it('escapes HTML special chars in user-controlled fields', () => {
    const html = generateInstallPage({ ...valid, appTitle: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
});

describe('generateSimulatorInstallPage', () => {
  const valid = {
    appTitle: 'My App',
    bundleId: 'com.example.app',
    version: '1.2.3',
    buildNumber: '42',
    commit: 'abc1234',
    profile: 'preview',
    artifactUrl: 'https://example.com/app.app.tgz',
    createdAt: '2026-05-20T12:00:00Z',
  };

  it('shows a simctl install one-liner with the artifact URL', () => {
    const html = generateSimulatorInstallPage(valid);
    assert.ok(html.includes('xcrun simctl install booted'));
    assert.ok(html.includes('https://example.com/app.app.tgz'));
    assert.ok(html.includes('xcrun simctl launch booted com.example.app'));
  });

  it('does not include an itms-services install button', () => {
    const html = generateSimulatorInstallPage(valid);
    assert.ok(!html.includes('itms-services://'));
    assert.ok(!html.includes('class="install-btn"'));
  });

  it('omits the launch command when bundleId is absent', () => {
    const html = generateSimulatorInstallPage({ ...valid, bundleId: undefined });
    assert.ok(html.includes('xcrun simctl install booted'));
    assert.ok(!html.includes('simctl launch'));
  });

  it('escapes HTML in the app title', () => {
    const html = generateSimulatorInstallPage({ ...valid, appTitle: '<b>x</b>' });
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  });
});
