import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildSshConfig, sshOptsFromHost } from '../../src/remote/ssh.js';

describe('buildSshConfig', () => {
  it('builds SSH config from options', () => {
    const config = buildSshConfig({ host: '1.2.3.4', privateKeyPath: '/path/to/key.pem', username: 'ec2-user' });
    assert.strictEqual(config.host, '1.2.3.4');
    assert.strictEqual(config.username, 'ec2-user');
    assert.strictEqual(config.privateKeyPath, '/path/to/key.pem');
    assert.strictEqual(config.port, 22);
  });

  it('defaults username to ec2-user and port to 22', () => {
    const config = buildSshConfig({ host: '1.2.3.4', privateKeyPath: '/path/to/key.pem' });
    assert.strictEqual(config.username, 'ec2-user');
    assert.strictEqual(config.port, 22);
  });

  it('supports password auth and custom port', () => {
    const config = buildSshConfig({ host: 'TX0.macincloud.com', username: 'user123', password: 'secret', port: 2222 });
    assert.strictEqual(config.username, 'user123');
    assert.strictEqual(config.password, 'secret');
    assert.strictEqual(config.port, 2222);
    assert.ok(!('privateKeyPath' in config));
  });

  it('omits password when not provided', () => {
    const config = buildSshConfig({ host: 'h', privateKeyPath: '/k' });
    assert.ok(!('password' in config));
  });
});

describe('sshOptsFromHost', () => {
  it('maps a macincloud host block to connection opts', () => {
    const opts = sshOptsFromHost({
      kind: 'macincloud',
      host: 'TX0.macincloud.com',
      port: 22,
      user: 'user123',
      password: 'secret',
    });
    assert.strictEqual(opts.host, 'TX0.macincloud.com');
    assert.strictEqual(opts.username, 'user123');
    assert.strictEqual(opts.password, 'secret');
    assert.strictEqual(opts.port, 22);
  });

  it('throws for unsupported kinds', () => {
    assert.throws(() => sshOptsFromHost({ kind: 'aws' }), /unsupported host\.kind/);
  });
});
