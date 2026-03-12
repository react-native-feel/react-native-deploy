import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCreateSgCommand, buildAuthorizeSshCommand } from '../../src/infra/security-group.js';

describe('security-group commands', () => {
  it('builds create command', () => {
    const cmd = buildCreateSgCommand('rn-deploy-sg', 'us-east-1');
    assert.ok(cmd.includes('create-security-group'));
    assert.ok(cmd.includes('rn-deploy-sg'));
    assert.ok(cmd.includes('us-east-1'));
  });

  it('builds authorize SSH command with IP', () => {
    const cmd = buildAuthorizeSshCommand('sg-123', '1.2.3.4', 'us-east-1');
    assert.ok(cmd.includes('authorize-security-group-ingress'));
    assert.ok(cmd.includes('sg-123'));
    assert.ok(cmd.includes('1.2.3.4/32'));
    assert.ok(cmd.includes('22'));
  });
});
