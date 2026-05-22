import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateManifestPlist } from '../../src/distribute/manifest.js';

describe('generateManifestPlist', () => {
  const valid = {
    ipaUrl: 'https://cdn.example.com/builds/abc/app.ipa',
    bundleId: 'com.example.app',
    bundleVersion: '1.2.3',
    title: 'My App',
  };

  it('produces a valid plist envelope', () => {
    const out = generateManifestPlist(valid);
    assert.ok(out.startsWith('<?xml'));
    assert.ok(out.includes('<plist version="1.0">'));
    assert.ok(out.trim().endsWith('</plist>'));
  });

  it('embeds the IPA URL as a software-package asset', () => {
    const out = generateManifestPlist(valid);
    assert.ok(out.includes('<string>software-package</string>'));
    assert.ok(out.includes(valid.ipaUrl));
  });

  it('embeds bundle-identifier, bundle-version, title in metadata', () => {
    const out = generateManifestPlist(valid);
    assert.ok(out.includes('<key>bundle-identifier</key>'));
    assert.ok(out.includes(`<string>${valid.bundleId}</string>`));
    assert.ok(out.includes(`<string>${valid.bundleVersion}</string>`));
    assert.ok(out.includes(`<string>${valid.title}</string>`));
  });

  it('escapes XML special chars in title', () => {
    const out = generateManifestPlist({ ...valid, title: 'A & B <c>' });
    assert.ok(out.includes('A &amp; B &lt;c&gt;'));
    assert.ok(!out.match(/<string>A & B <c><\/string>/));
  });

  it('includes optional display-image / full-size-image assets when provided', () => {
    const out = generateManifestPlist({
      ...valid,
      displayImageUrl: 'https://cdn.example.com/icon-57.png',
      fullSizeImageUrl: 'https://cdn.example.com/icon-512.png',
    });
    assert.ok(out.includes('<string>display-image</string>'));
    assert.ok(out.includes('<string>full-size-image</string>'));
  });

  it('throws when required fields are missing', () => {
    assert.throws(() => generateManifestPlist({}), /requires/);
    assert.throws(() => generateManifestPlist({ ...valid, ipaUrl: undefined }), /requires/);
  });
});
