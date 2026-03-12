import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildRunCommand, buildTerminateCommand } from '../../src/infra/instance.js';

describe('instance commands', () => {
  it('builds run-instances command', () => {
    const cmd = buildRunCommand({ amiId: 'ami-123', instanceType: 'mac2.metal', keyName: 'my-key', sgId: 'sg-123', hostId: 'h-123', region: 'us-east-1' });
    assert.ok(cmd.includes('run-instances'));
    assert.ok(cmd.includes('ami-123'));
    assert.ok(cmd.includes('mac2.metal'));
    assert.ok(cmd.includes('my-key'));
    assert.ok(cmd.includes('sg-123'));
    assert.ok(cmd.includes('h-123'));
  });

  it('builds terminate command', () => {
    const cmd = buildTerminateCommand('i-123', 'us-east-1');
    assert.ok(cmd.includes('terminate-instances'));
    assert.ok(cmd.includes('i-123'));
  });
});
