import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getExpoBuildSteps } from '../../src/build/expo.js';

describe('expo build strategy', () => {
  it('returns correct build steps', () => {
    const steps = getExpoBuildSteps({
      scheme: 'MyApp',
      buildConfiguration: 'Release',
      workDir: '~/build-workspace',
    });
    assert.ok(steps.length > 0);
    assert.ok(steps.some(s => s.cmd.includes('expo prebuild')));
    assert.ok(steps.some(s => s.cmd.includes('xcodebuild archive')));
    assert.ok(steps.some(s => s.cmd.includes('xcodebuild -exportArchive')));
  });

  it('includes pod install step', () => {
    const steps = getExpoBuildSteps({
      scheme: 'MyApp',
      buildConfiguration: 'Release',
      workDir: '~/build-workspace',
    });
    assert.ok(steps.some(s => s.cmd.includes('pod install')));
  });
});
