import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getIpaFindCommand, getLocalArtifactPath } from '../../src/build/artifacts.js';

describe('artifacts', () => {
  it('generates find command for .ipa files', () => {
    const cmd = getIpaFindCommand('~/build-workspace/build/export');
    assert.ok(cmd.includes('find'));
    assert.ok(cmd.includes('.ipa'));
  });

  it('generates local artifact path', () => {
    const path = getLocalArtifactPath('/project', 'MyApp');
    assert.ok(path.includes('build'));
    assert.ok(path.includes('MyApp'));
    assert.ok(path.endsWith('.ipa'));
  });
});
