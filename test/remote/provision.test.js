import { describe, it } from 'node:test';
import assert from 'node:assert';
import { provisionManagedHost, cloneRepo } from '../../src/remote/provision.js';

// Fake NodeSSH: execCommand resolves {code,stdout,stderr}. `failing` is a list
// of substrings; any command containing one returns a non-zero exit code.
function fakeSsh(failing = []) {
  const commands = [];
  return {
    commands,
    execCommand(command) {
      commands.push(command);
      const fails = failing.some(f => command.includes(f));
      return Promise.resolve({
        code: fails ? 1 : 0,
        stdout: fails ? '' : 'ok',
        stderr: fails ? 'not found' : '',
      });
    },
  };
}

describe('provisionManagedHost', () => {
  it('returns caps when all tools present', async () => {
    const ssh = fakeSsh([]);
    const caps = await provisionManagedHost(ssh);
    assert.strictEqual(caps.tmux, true);
  });

  it('throws listing every missing required tool', async () => {
    const ssh = fakeSsh(['xcodebuild', 'pod --version']);
    await assert.rejects(
      () => provisionManagedHost(ssh),
      (err) => {
        assert.match(err.message, /missing required tools/);
        assert.match(err.message, /Xcode/);
        assert.match(err.message, /CocoaPods/);
        return true;
      }
    );
  });

  it('degrades gracefully when only optional tmux is missing', async () => {
    const ssh = fakeSsh(['tmux']);
    const caps = await provisionManagedHost(ssh);
    assert.strictEqual(caps.tmux, false);
  });
});

describe('cloneRepo', () => {
  it('clones into the default workspace', async () => {
    const ssh = fakeSsh([]);
    const dir = await cloneRepo(ssh, 'git@github.com:u/a.git', 'main');
    assert.strictEqual(dir, '~/build-workspace');
    assert.ok(ssh.commands.some(c => c.includes('git clone') && c.includes('~/build-workspace')));
  });

  it('honors a custom workDir', async () => {
    const ssh = fakeSsh([]);
    const dir = await cloneRepo(ssh, 'git@github.com:u/a.git', 'dev', '~/rn-deploy-work');
    assert.strictEqual(dir, '~/rn-deploy-work');
    assert.ok(ssh.commands.some(c => c.includes('--branch dev')));
    assert.ok(ssh.commands.some(c => c.includes('rm -rf ~/rn-deploy-work')));
  });
});
