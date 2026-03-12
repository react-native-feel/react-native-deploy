import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getClassicBuildSteps } from '../../src/build/classic.js';

describe('classic build strategy', () => {
  it('returns correct build steps', () => {
    const steps = getClassicBuildSteps({
      scheme: 'MyApp',
      buildConfiguration: 'Release',
      workDir: '~/build-workspace',
    });
    assert.ok(steps.length > 0);
    assert.ok(steps.some(s => s.cmd.includes('xcodebuild archive')));
    assert.ok(steps.some(s => s.cmd.includes('xcodebuild -exportArchive')));
  });

  it('does NOT include expo prebuild', () => {
    const steps = getClassicBuildSteps({
      scheme: 'MyApp',
      buildConfiguration: 'Release',
      workDir: '~/build-workspace',
    });
    assert.ok(!steps.some(s => s.cmd.includes('expo prebuild')));
  });
});
