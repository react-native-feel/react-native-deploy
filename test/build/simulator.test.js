import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getSimulatorBuildSteps,
  getSimulatorAppPath,
  getSimulatorTarballPath,
  getSimulatorProductsDir,
} from '../../src/build/simulator.js';
import { getExpoBuildSteps } from '../../src/build/expo.js';
import { getClassicBuildSteps } from '../../src/build/classic.js';

describe('simulator build steps', () => {
  const opts = { scheme: 'MyApp', buildConfiguration: 'Release', workDir: '~/work' };

  it('builds with iphonesimulator sdk and no codesigning', () => {
    const steps = getSimulatorBuildSteps(opts);
    const build = steps.find(s => s.cmd.includes('xcodebuild build'));
    assert.ok(build);
    assert.ok(build.cmd.includes('-sdk iphonesimulator'));
    assert.ok(build.cmd.includes('CODE_SIGNING_ALLOWED=NO'));
    assert.ok(!build.cmd.includes('archive '));
  });

  it('tars the .app into a tarball', () => {
    const steps = getSimulatorBuildSteps(opts);
    assert.ok(steps.some(s => s.cmd.includes('tar -czf') && s.cmd.includes('MyApp.app')));
  });

  it('path helpers agree on the products directory', () => {
    assert.strictEqual(
      getSimulatorAppPath('~/work', 'MyApp', 'Release'),
      `${getSimulatorProductsDir('~/work', 'Release')}/MyApp.app`
    );
    assert.strictEqual(getSimulatorTarballPath('~/work', 'MyApp'), '~/work/build/MyApp.app.tgz');
  });
});

describe('build-step generators honor distribution', () => {
  const opts = { scheme: 'MyApp', buildConfiguration: 'Release', workDir: '~/work' };

  it('expo: simulator distribution swaps archive/export for sim build', () => {
    const steps = getExpoBuildSteps({ ...opts, distribution: 'simulator' });
    assert.ok(steps.some(s => s.cmd.includes('expo prebuild')));
    assert.ok(steps.some(s => s.cmd.includes('-sdk iphonesimulator')));
    assert.ok(!steps.some(s => s.cmd.includes('xcodebuild archive')));
    assert.ok(!steps.some(s => s.cmd.includes('-exportArchive')));
  });

  it('expo: default distribution keeps archive + export', () => {
    const steps = getExpoBuildSteps(opts);
    assert.ok(steps.some(s => s.cmd.includes('xcodebuild archive')));
    assert.ok(steps.some(s => s.cmd.includes('-exportArchive')));
  });

  it('classic: simulator distribution swaps archive/export for sim build', () => {
    const steps = getClassicBuildSteps({ ...opts, distribution: 'simulator' });
    assert.ok(steps.some(s => s.cmd.includes('-sdk iphonesimulator')));
    assert.ok(!steps.some(s => s.cmd.includes('xcodebuild archive')));
  });
});
