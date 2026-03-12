import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getKeyPairCommands } from '../../src/infra/key-pair.js';

describe('key-pair commands', () => {
  it('generates create command with correct params', () => {
    const cmds = getKeyPairCommands('rn-deploy-key', 'us-east-1');
    assert.ok(cmds.create.includes('create-key-pair'));
    assert.ok(cmds.create.includes('rn-deploy-key'));
    assert.ok(cmds.create.includes('us-east-1'));
  });

  it('generates describe command', () => {
    const cmds = getKeyPairCommands('rn-deploy-key', 'us-east-1');
    assert.ok(cmds.describe.includes('describe-key-pairs'));
    assert.ok(cmds.describe.includes('rn-deploy-key'));
  });

  it('generates delete command', () => {
    const cmds = getKeyPairCommands('rn-deploy-key', 'us-east-1');
    assert.ok(cmds.delete.includes('delete-key-pair'));
  });
});
