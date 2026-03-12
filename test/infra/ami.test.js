import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCreateImageCommand, buildDescribeImagesCommand, buildDeregisterCommand } from '../../src/infra/ami.js';

describe('ami commands', () => {
  it('builds create-image command', () => {
    const cmd = buildCreateImageCommand('i-123', 'rn-deploy-custom', 'us-east-1');
    assert.ok(cmd.includes('create-image'));
    assert.ok(cmd.includes('i-123'));
    assert.ok(cmd.includes('rn-deploy-custom'));
  });

  it('builds describe-images command', () => {
    const cmd = buildDescribeImagesCommand('us-east-1');
    assert.ok(cmd.includes('describe-images'));
    assert.ok(cmd.includes('--owners self'));
  });

  it('builds deregister command', () => {
    const cmd = buildDeregisterCommand('ami-123', 'us-east-1');
    assert.ok(cmd.includes('deregister-image'));
    assert.ok(cmd.includes('ami-123'));
  });
});
