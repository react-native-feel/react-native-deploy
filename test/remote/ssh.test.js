import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildSshConfig } from '../../src/remote/ssh.js';

describe('ssh utils', () => {
  it('builds SSH config from state', () => {
    const config = buildSshConfig('1.2.3.4', '/path/to/key.pem', 'ec2-user');
    assert.strictEqual(config.host, '1.2.3.4');
    assert.strictEqual(config.username, 'ec2-user');
    assert.strictEqual(config.privateKeyPath, '/path/to/key.pem');
  });

  it('defaults username to ec2-user', () => {
    const config = buildSshConfig('1.2.3.4', '/path/to/key.pem');
    assert.strictEqual(config.username, 'ec2-user');
  });
});
