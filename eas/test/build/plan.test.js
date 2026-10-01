import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDispatchInputs,
  isPaidOnlyRunner,
  resolveArtifactExtension,
  resolveGradleCommand,
  resolveIosExportMethod,
  resolvePackageManager,
  resolveRunner,
  validateBuildable,
} from '../../src/build/plan.js';
import { EasJsonAccessor } from '../../src/easjson/accessor.js';
import { EasJsonUtils } from '../../src/easjson/utils.js';

/** Resolves a profile through the real pipeline so these tests exercise the merge too. */
async function profileFor(easJson, platform, profileName) {
  return EasJsonUtils.getBuildProfileAsync(
    EasJsonAccessor.fromRawString(JSON.stringify(easJson)),
    platform,
    profileName
  );
}

describe('iOS export method', () => {
  it('sends store builds to the App Store', () => {
    assert.equal(resolveIosExportMethod({ distribution: 'store' }), 'app-store');
  });

  it('uses ad-hoc for internal distribution', () => {
    assert.equal(resolveIosExportMethod({ distribution: 'internal' }), 'ad-hoc');
  });

  it('uses enterprise when universal provisioning is requested', () => {
    assert.equal(
      resolveIosExportMethod({ distribution: 'internal', enterpriseProvisioning: 'universal' }),
      'enterprise'
    );
  });

  it('keeps adhoc enterprise provisioning on ad-hoc', () => {
    assert.equal(
      resolveIosExportMethod({ distribution: 'internal', enterpriseProvisioning: 'adhoc' }),
      'ad-hoc'
    );
  });

  it('has no export method for a simulator build', () => {
    assert.equal(resolveIosExportMethod({ distribution: 'internal', simulator: true }), null);
  });
});

describe('Gradle command', () => {
  it('prefers an explicit gradleCommand over buildType', () => {
    assert.equal(
      resolveGradleCommand({ gradleCommand: ':app:assembleProdRelease', buildType: 'app-bundle' }),
      ':app:assembleProdRelease'
    );
  });

  it('maps buildType apk to assembleRelease', () => {
    assert.equal(resolveGradleCommand({ buildType: 'apk' }), ':app:assembleRelease');
  });

  it('maps buildType app-bundle to bundleRelease', () => {
    assert.equal(resolveGradleCommand({ buildType: 'app-bundle' }), ':app:bundleRelease');
  });

  it('defaults store builds to an app bundle', () => {
    assert.equal(resolveGradleCommand({ distribution: 'store' }), ':app:bundleRelease');
  });

  it('defaults internal builds to an APK, since a device cannot install an .aab', () => {
    assert.equal(resolveGradleCommand({ distribution: 'internal' }), ':app:assembleRelease');
  });
});

describe('artifact extension', () => {
  it('is ipa for a signed iOS build', () => {
    assert.equal(resolveArtifactExtension('ios', { distribution: 'store' }), 'ipa');
  });

  it('is app for an iOS simulator build', () => {
    assert.equal(resolveArtifactExtension('ios', { simulator: true }), 'app');
  });

  it('follows the gradle command for Android', () => {
    assert.equal(resolveArtifactExtension('android', { buildType: 'apk' }), 'apk');
    assert.equal(resolveArtifactExtension('android', { buildType: 'app-bundle' }), 'aab');
    assert.equal(
      resolveArtifactExtension('android', { gradleCommand: ':app:bundleProdRelease' }),
      'aab'
    );
  });
});

describe('runner selection', () => {
  it('keeps default and medium on the included-minutes runner', () => {
    assert.equal(resolveRunner('ios', {}), 'macos-26');
    assert.equal(resolveRunner('ios', { resourceClass: 'medium' }), 'macos-26');
    assert.equal(resolveRunner('ios', { resourceClass: 'm-medium' }), 'macos-26');
  });

  it('escalates large classes to an xlarge runner', () => {
    assert.equal(resolveRunner('ios', { resourceClass: 'large' }), 'macos-26-xlarge');
    assert.equal(resolveRunner('ios', { resourceClass: 'm-large' }), 'macos-26-xlarge');
  });

  it('flags xlarge macOS runners as always-billed', () => {
    assert.equal(isPaidOnlyRunner('macos-26'), false);
    assert.equal(isPaidOnlyRunner('macos-26-xlarge'), true);
    assert.equal(isPaidOnlyRunner('ubuntu-latest'), false);
  });

  it('keeps Android on Ubuntu regardless of class', () => {
    assert.match(resolveRunner('android', { resourceClass: 'large' }), /^ubuntu/);
  });
});

describe('package manager detection', () => {
  it('follows the committed lockfile', () => {
    assert.equal(resolvePackageManager({}, ['bun.lock']).name, 'bun');
    assert.equal(resolvePackageManager({}, ['pnpm-lock.yaml']).name, 'pnpm');
    assert.equal(resolvePackageManager({}, ['yarn.lock']).name, 'yarn');
    assert.equal(resolvePackageManager({}, ['package-lock.json']).name, 'npm');
  });

  it('defaults to npm when nothing is committed', () => {
    assert.equal(resolvePackageManager({}, []).name, 'npm');
    assert.equal(resolvePackageManager({}, []).install, 'npm ci');
  });

  it('lets a version pin in the profile decide', () => {
    const pm = resolvePackageManager({ pnpm: '9.12.0' }, ['yarn.lock']);
    assert.equal(pm.name, 'pnpm');
    assert.equal(pm.version, '9.12.0');
  });

  it('uses a frozen lockfile so CI cannot drift from the committed tree', () => {
    assert.match(resolvePackageManager({}, ['bun.lock']).install, /frozen-lockfile/);
    assert.match(resolvePackageManager({}, ['pnpm-lock.yaml']).install, /frozen-lockfile/);
    assert.match(resolvePackageManager({}, ['yarn.lock']).install, /immutable/);
  });
});

describe('dispatch inputs from a real eas.json', () => {
  const easJson = {
    build: {
      base: { node: '20.18.0', env: { SHARED: 'yes' } },
      development: {
        extends: 'base',
        developmentClient: true,
        distribution: 'internal',
        channel: 'development',
        env: { APP_VARIANT: 'development' },
        ios: { simulator: false, buildConfiguration: 'Debug', scheme: 'MyApp' },
        android: { buildType: 'apk' },
      },
      production: {
        extends: 'base',
        channel: 'production',
        env: { APP_VARIANT: 'production' },
        ios: { autoIncrement: 'buildNumber', resourceClass: 'large' },
        android: { buildType: 'app-bundle' },
      },
    },
  };

  it('carries the merged env through as JSON', async () => {
    const profile = await profileFor(easJson, 'ios', 'development');
    const inputs = buildDispatchInputs({
      platform: 'ios',
      profile,
      profileName: 'development',
      ref: 'main',
    });
    assert.deepEqual(JSON.parse(inputs.env_json), { SHARED: 'yes', APP_VARIANT: 'development' });
  });

  it('translates a development profile into a signed ad-hoc Debug build', async () => {
    const profile = await profileFor(easJson, 'ios', 'development');
    const inputs = buildDispatchInputs({
      platform: 'ios',
      profile,
      profileName: 'development',
      ref: 'main',
    });
    assert.equal(inputs.export_method, 'ad-hoc');
    assert.equal(inputs.build_configuration, 'Debug');
    assert.equal(inputs.scheme, 'MyApp');
    assert.equal(inputs.development_client, 'true');
    assert.equal(inputs.channel, 'development');
    assert.equal(inputs.without_credentials, 'false');
    assert.equal(inputs.node_version, '20.18.0');
  });

  it('never mistakes the Expo URL scheme for an Xcode scheme', async () => {
    const profile = await profileFor(easJson, 'ios', 'production');
    const inputs = buildDispatchInputs({
      platform: 'ios',
      profile,
      profileName: 'production',
      ref: 'main',
      appConfig: { scheme: 'myapp', ios: {}, android: {} },
    });
    // Empty lets the runner resolve it from the workspace prebuild generated.
    assert.equal(inputs.scheme, '');
  });

  it('translates a production profile into an App Store build on a paid runner', async () => {
    const profile = await profileFor(easJson, 'ios', 'production');
    const inputs = buildDispatchInputs({
      platform: 'ios',
      profile,
      profileName: 'production',
      ref: 'main',
    });
    assert.equal(inputs.export_method, 'app-store');
    assert.equal(inputs.build_configuration, 'Release');
    assert.equal(inputs.runner, 'macos-26-xlarge');
    assert.equal(inputs.auto_increment, 'buildNumber');
    assert.equal(inputs.development_client, 'false');
  });

  it('picks the right Gradle task per profile', async () => {
    const dev = await profileFor(easJson, 'android', 'development');
    const prod = await profileFor(easJson, 'android', 'production');
    assert.equal(
      buildDispatchInputs({ platform: 'android', profile: dev, profileName: 'development', ref: 'main' })
        .gradle_command,
      // developmentClient implies a debug build in EAS, whatever buildType says.
      ':app:assembleDebug'
    );
    assert.equal(
      buildDispatchInputs({ platform: 'android', profile: prod, profileName: 'production', ref: 'main' })
        .gradle_command,
      ':app:bundleRelease'
    );
  });

  it('drops credentials for a simulator build without being told to', async () => {
    const profile = await profileFor(
      { build: { sim: { distribution: 'internal', ios: { simulator: true } } } },
      'ios',
      'sim'
    );
    const inputs = buildDispatchInputs({
      platform: 'ios',
      profile,
      profileName: 'sim',
      ref: 'main',
    });
    assert.equal(inputs.simulator, 'true');
    assert.equal(inputs.without_credentials, 'true');
    assert.equal(inputs.export_method, '');
  });
});

describe('pre-dispatch validation', () => {
  it('rejects a simulator build aimed at the App Store', () => {
    const errors = validateBuildable({
      platform: 'ios',
      profile: { simulator: true, distribution: 'store' },
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /simulator build cannot be distributed to the App Store/);
  });

  it('rejects an .aab for internal distribution, which no device can install', () => {
    const errors = validateBuildable({
      platform: 'android',
      profile: { distribution: 'internal', buildType: 'app-bundle' },
    });
    assert.match(errors[0], /cannot be installed on a device/);
  });

  it('catches missing iOS credentials before a billed runner starts', () => {
    const errors = validateBuildable({
      platform: 'ios',
      profile: { distribution: 'store' },
      credentials: { ios: false },
    });
    assert.match(errors[0], /needs iOS signing credentials/);
  });

  it('does not ask for credentials a simulator build will never use', () => {
    const errors = validateBuildable({
      platform: 'ios',
      profile: { distribution: 'internal', simulator: true },
      credentials: { ios: false },
    });
    assert.deepEqual(errors, []);
  });

  it('accepts a well-formed production profile', () => {
    const errors = validateBuildable({
      platform: 'ios',
      profile: { distribution: 'store' },
      credentials: { ios: true },
    });
    assert.deepEqual(errors, []);
  });
});
