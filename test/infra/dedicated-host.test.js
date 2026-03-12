import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildAllocateCommand, buildDescribeCommand, buildReleaseCommand } from '../../src/infra/dedicated-host.js';

describe('dedicated-host commands', () => {
  it('builds allocate command', () => {
    const cmd = buildAllocateCommand('us-east-1a', 'mac2.metal', 'us-east-1');
    assert.ok(cmd.includes('allocate-hosts'));
    assert.ok(cmd.includes('mac2'));
    assert.ok(cmd.includes('us-east-1a'));
  });

  it('builds describe command', () => {
    const cmd = buildDescribeCommand('h-123', 'us-east-1');
    assert.ok(cmd.includes('describe-hosts'));
    assert.ok(cmd.includes('h-123'));
  });

  it('builds release command', () => {
    const cmd = buildReleaseCommand('h-123', 'us-east-1');
    assert.ok(cmd.includes('release-hosts'));
    assert.ok(cmd.includes('h-123'));
  });
});
