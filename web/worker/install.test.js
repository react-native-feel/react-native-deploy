import { describe, expect, it } from 'vitest';

import {
  devicePlatform,
  installPage,
  iosManifest,
  itmsServicesUrl,
  parseUploadKey,
} from './install.js';

const ID = '0f8b5c3e-1a2b-4c3d-8e9f-0123456789ab';

describe('upload keys', () => {
  it('accepts only builds/<dispatch-id>/<known file>', () => {
    expect(parseUploadKey(`builds/${ID}/app.ipa`)).toEqual({ dispatchId: ID, file: 'app.ipa' });
    expect(parseUploadKey(`builds/${ID}/meta.json`)?.file).toBe('meta.json');
  });

  it('rejects traversal, unknown files and non-uuid ids', () => {
    expect(parseUploadKey(`builds/${ID}/../other/app.ipa`)).toBeNull();
    expect(parseUploadKey(`builds/${ID}/index.html`)).toBeNull();
    expect(parseUploadKey('builds/12345/app.ipa')).toBeNull();
    expect(parseUploadKey(`other/${ID}/app.ipa`)).toBeNull();
  });
});

describe('iOS OTA manifest', () => {
  it('points at the IPA and escapes metadata', () => {
    const plist = iosManifest({
      ipaUrl: 'https://x.dev/install/a/app.ipa',
      bundleId: 'com.acme.app',
      version: '1.0.0',
      title: 'Tom & Jerry <beta>',
    });
    expect(plist).toContain('<string>https://x.dev/install/a/app.ipa</string>');
    expect(plist).toContain('<string>com.acme.app</string>');
    expect(plist).toContain('Tom &amp; Jerry &lt;beta&gt;');
    expect(plist).toContain('<string>software-package</string>');
  });

  it('url-encodes the manifest URL inside the itms-services link', () => {
    expect(itmsServicesUrl('https://x.dev/install/a/manifest.plist')).toBe(
      'itms-services://?action=download-manifest&url=https%3A%2F%2Fx.dev%2Finstall%2Fa%2Fmanifest.plist'
    );
  });
});

describe('install page', () => {
  const ios = { platform: 'ios', name: 'My App', bundleId: 'com.acme.app', version: '1.0.0', profile: 'preview' };
  const android = { ...ios, platform: 'android' };
  const urls = { pageUrl: 'https://x.dev/install/a', manifestUrl: 'https://x.dev/install/a/manifest.plist', fileUrl: 'https://x.dev/install/a/app.apk' };

  it('gives an iPhone the itms-services link', () => {
    const page = installPage({ meta: ios, device: 'ios', ...urls });
    expect(page).toContain('href="itms-services://?action=download-manifest&amp;url=https%3A%2F%2Fx.dev');
    expect(page).toContain('Developer Mode');
  });

  it('gives an Android phone the APK', () => {
    const page = installPage({ meta: android, device: 'android', ...urls });
    expect(page).toContain('href="https://x.dev/install/a/app.apk" download');
  });

  it('shows a desktop a QR code that encodes the install page', () => {
    const page = installPage({ meta: ios, device: 'other', ...urls });
    expect(page).toContain('<div class="qr"');
    expect(page).toContain('<svg');
    expect(page).toContain(urls.pageUrl);
  });

  it('draws the QR only for desktops, never on the phone itself', () => {
    expect(installPage({ meta: ios, device: 'ios', ...urls })).not.toContain('<div class="qr"');
    expect(installPage({ meta: android, device: 'android', ...urls })).not.toContain('<div class="qr"');
  });

  it('tells a desktop to open the link on the device, and never offers a mismatched build', () => {
    expect(installPage({ meta: ios, device: 'other', ...urls })).toContain('Scan with your iPhone or iPad');
    expect(installPage({ meta: ios, device: 'android', ...urls })).toContain('cannot be installed on this device');
  });

  it('escapes app metadata', () => {
    expect(installPage({ meta: { ...ios, name: '<script>x</script>' }, device: 'ios', ...urls })).not.toContain('<script>x');
  });
});

describe('device detection', () => {
  it('recognises phones and iPadOS desktop-class Safari', () => {
    expect(devicePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)')).toBe('ios');
    expect(devicePlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(devicePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Mobile/15E148')).toBe('ios');
    expect(devicePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140')).toBe('other');
  });
});
