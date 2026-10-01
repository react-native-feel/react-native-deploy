import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_WORKFLOW_DISPATCH_INPUTS,
  buildDispatchInputs,
  packForDispatch,
  unpackDispatch,
} from '../../src/build/plan.js';

/**
 * The CLI and the workflow are two halves of one contract that no type checker
 * spans: the CLI packs a plan, the workflow unpacks it on a runner. A mismatch
 * does not fail fast — it fails eight minutes into a billed macOS job, or worse,
 * succeeds having signed the wrong thing. So the two are compared here.
 */

const workflow = readFileSync(
  fileURLToPath(new URL('../../templates/eas-build.yml', import.meta.url)),
  'utf-8'
);

/** The `workflow_dispatch.inputs` keys, read straight out of the YAML. */
function declaredInputs() {
  const section = workflow.match(/workflow_dispatch:\s*\n\s*inputs:\n([\s\S]*?)\n\nconcurrency:/);
  assert.ok(section, 'could not locate workflow_dispatch inputs in the template');
  return [...section[1].matchAll(/^ {6}(\w+):$/gm)].map((m) => m[1]);
}

/** Every `steps.plan.outputs.X` the workflow reads. */
function referencedPlanOutputs() {
  return [...new Set([...workflow.matchAll(/steps\.plan\.outputs\.(\w+)/g)].map((m) => m[1]))];
}

const iosPlan = buildDispatchInputs({
  platform: 'ios',
  profile: {
    distribution: 'store',
    node: '20.18.0',
    scheme: 'MyApp',
    buildConfiguration: 'Release',
    env: { API_URL: 'https://example.com' },
    cache: { key: 'v1' },
  },
  profileName: 'production',
  ref: 'main',
  lockfiles: ['bun.lock'],
  appConfig: { version: '1.0.0' },
});

const androidPlan = buildDispatchInputs({
  platform: 'android',
  profile: { distribution: 'store', buildType: 'app-bundle', ndk: '26.1.0' },
  profileName: 'production',
  ref: 'main',
});

describe('workflow dispatch inputs', () => {
  it('the packed payload matches what the workflow declares', () => {
    const packed = Object.keys(packForDispatch(iosPlan, { dispatchId: 'x' })).sort();
    assert.deepEqual(packed, declaredInputs().sort());
  });

  it('stays within GitHub\'s ten-input cap', () => {
    for (const plan of [iosPlan, androidPlan]) {
      const packed = packForDispatch(plan, { dispatchId: 'x' });
      assert.ok(
        Object.keys(packed).length <= MAX_WORKFLOW_DISPATCH_INPUTS,
        `packed ${Object.keys(packed).length} inputs`
      );
    }
  });

  it('survives a pack/unpack round trip without losing a field', () => {
    for (const plan of [iosPlan, androidPlan]) {
      const round = unpackDispatch(packForDispatch(plan, { dispatchId: 'x' }));
      for (const [key, value] of Object.entries(plan)) {
        assert.equal(round[key], value, `field "${key}" did not survive the round trip`);
      }
    }
  });
});

describe('workflow plan outputs', () => {
  it('every steps.plan.outputs.X the workflow reads is produced by the CLI', () => {
    const available = new Set([
      ...Object.keys(iosPlan),
      ...Object.keys(androidPlan),
      // Fanned out by the Prepare step from the packed blob, minus env_json,
      // which is exported to the environment rather than to an output.
    ]);
    const missing = referencedPlanOutputs().filter((name) => !available.has(name));
    assert.deepEqual(
      missing,
      [],
      `the workflow reads plan outputs the CLI never sends: ${missing.join(', ')}`
    );
  });

  it('reads the fields that decide signing and packaging', () => {
    const referenced = referencedPlanOutputs();
    for (const key of ['export_method', 'simulator', 'without_credentials', 'gradle_command', 'scheme']) {
      assert.ok(referenced.includes(key), `the workflow never reads "${key}"`);
    }
  });
});

describe('workflow safety properties', () => {
  it('builds with the resolved Xcode scheme, falling back to the prebuilt workspace', () => {
    const resolve = workflow.slice(workflow.indexOf('name: Resolve Xcode scheme'));
    assert.match(resolve, /find ios -maxdepth 1 -name '\*\.xcworkspace'/);
    for (const step of ['Archive (iOS)', 'Export IPA', 'Build for simulator (iOS)']) {
      const body = workflow.slice(workflow.indexOf(`name: ${step}`)).split('\n      - name:')[0];
      assert.match(body, /steps\.xcode\.outputs\.scheme/, `${step} must use the resolved scheme`);
    }
  });

  it('stamps the dispatch id into run-name so the CLI can find the run', () => {
    assert.match(workflow, /run-name:/);
    assert.match(workflow, /\[eas:dispatch_id=\$\{\{ inputs\.dispatch_id \}\}/);
  });

  it('stamps distribution and simulator so build:list can title and filter runs', () => {
    // Without these every run maps to a "production build" and the
    // distribution filter that "eas submit" relies on matches nothing.
    assert.match(workflow, /distribution=\$\{\{ fromJSON\(inputs\.config_json\)\.distribution \}\}/);
    assert.match(workflow, /simulator=\$\{\{ fromJSON\(inputs\.config_json\)\.simulator \}\}/);
  });

  it('fails the step when xcodebuild fails, instead of uploading an empty bundle', () => {
    assert.doesNotMatch(workflow, /xcpretty \|\| true/);
    assert.equal((workflow.match(/STATUS=\$\{PIPESTATUS\[0\]\}/g) ?? []).length, 2);
  });

  it('tells Xcode which profile, team and identity to sign with', () => {
    // Importing the assets is not enough: a freshly prebuilt project has no
    // signing settings, and archive fails with "requires a provisioning profile".
    const apply = workflow.slice(workflow.indexOf('name: Apply signing settings'));
    assert.match(apply, /PROVISIONING_PROFILE_SPECIFIER/);
    assert.match(apply, /DEVELOPMENT_TEAM/);
    const archive = workflow.slice(workflow.indexOf('name: Archive (iOS)')).split('\n      - name:')[0];
    assert.doesNotMatch(archive, /PROVISIONING_PROFILE_SPECIFIER=/, 'a global specifier breaks Pods bundles');
    const exportStep = workflow.slice(workflow.indexOf('name: Export IPA')).split('\n      - name:')[0];
    assert.match(exportStep, /<key>provisioningProfiles<\/key>/);
    assert.match(exportStep, /<key>teamID<\/key>/);
  });

  it('signs internal builds with the ad-hoc profile, never the App Store one', () => {
    const importStep = workflow.slice(workflow.indexOf('name: Import signing credentials')).split('\n      - name:')[0];
    assert.match(importStep, /EAS_IOS_PROFILE_INTERNAL/);
    assert.match(importStep, /export_method \}\}' = 'ad-hoc'/);
  });

  it('publishes only internal device builds for install, binary before meta.json', () => {
    const publish = workflow.slice(workflow.indexOf('name: Publish for install')).split('\n      - name:')[0];
    assert.match(publish, /if: steps\.plan\.outputs\.distribution == 'internal' && steps\.plan\.outputs\.simulator != 'true'/);
    assert.match(publish, /inputs\.dispatch_id/);
    // The page appears when meta.json exists, so it must never point at a
    // half-uploaded binary.
    assert.ok(publish.indexOf('mpu=complete') < publish.indexOf('/meta.json'));
    assert.doesNotMatch(publish, /echo[^\n]*\$\{?INSTALL_TOKEN/, 'the upload token must never be echoed');
  });

  it('always deletes the signing keychain, even when the build fails', () => {
    assert.match(workflow, /name: Clean up credentials\n\s*if: always\(\)/);
    assert.match(workflow, /security delete-keychain/);
  });

  it('never imports signing assets into the login keychain', () => {
    const importStep = workflow.slice(workflow.indexOf('Import signing credentials'));
    assert.match(importStep, /RUNNER_TEMP\/eas-build\.keychain-db/);
    assert.ok(
      !/security import[^\n]*login\.keychain/.test(importStep),
      'signing assets must not be imported into the login keychain'
    );
  });

  it('fails the build when an artifact was expected but not produced', () => {
    assert.match(workflow, /if-no-files-found: error/);
  });

  it('tars simulator .app bundles rather than uploading them raw', () => {
    // upload-artifact flattens symlinks inside a .app, producing a bundle the
    // simulator refuses to install.
    assert.match(workflow, /tar -czf[^\n]*simulator\.tar\.gz/);
  });

  it('exports the profile env before the app config is read', () => {
    const envStep = workflow.indexOf('Export build environment');
    const prebuildStep = workflow.indexOf('name: Prebuild');
    assert.ok(envStep > 0 && prebuildStep > envStep, 'env must be exported before prebuild runs');
  });

  it('checks out with full history, which expo-updates runtime versions can depend on', () => {
    assert.match(workflow, /fetch-depth: 0/);
  });
});
