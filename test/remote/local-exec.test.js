import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSsh } from '../../src/remote/local-exec.js';
import { sshExec, sshUpload, sshDownload, withCommandPrefix, detectShellEnvPrefix } from '../../src/remote/ssh.js';

describe('LocalSsh', () => {
  it('runs a command and captures stdout + exit code', async () => {
    const ssh = new LocalSsh();
    const r = await ssh.execCommand('echo hello');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout.trim(), 'hello');
  });

  it('reports non-zero exit codes', async () => {
    const ssh = new LocalSsh();
    const r = await ssh.execCommand('exit 3');
    assert.strictEqual(r.code, 3);
  });

  it('honors compound commands and cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'localssh-'));
    try {
      const ssh = new LocalSsh({ cwd: dir });
      const r = await ssh.execCommand('mkdir sub && cd sub && pwd');
      assert.ok(r.stdout.includes('sub'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('works through sshExec (throws on failure, returns on success)', async () => {
    const ssh = new LocalSsh();
    const r = await sshExec(ssh, 'echo viaSshExec');
    assert.strictEqual(r.stdout.trim(), 'viaSshExec');
    await assert.rejects(() => sshExec(ssh, 'exit 1'), /Command failed/);
  });

  it('withCommandPrefix prepends to every execCommand', async () => {
    const ssh = new LocalSsh();
    const wrapped = withCommandPrefix(ssh, 'export FOO=bar; ');
    const r = await wrapped.execCommand('echo $FOO');
    assert.strictEqual(r.stdout.trim(), 'bar');
  });

  it('withCommandPrefix is a no-op for empty prefix', () => {
    const ssh = new LocalSsh();
    assert.strictEqual(withCommandPrefix(ssh, ''), ssh);
  });

  it('detectShellEnvPrefix returns a brew shellenv string or empty', async () => {
    // Stub ssh whose execCommand reports the first probed brew path as present.
    const ssh = {
      execCommand: (cmd) => Promise.resolve({
        code: 0,
        stdout: cmd.includes('/opt/homebrew/bin/brew') ? 'ok' : '',
        stderr: '',
      }),
    };
    const prefix = await detectShellEnvPrefix(ssh);
    assert.ok(prefix.includes('/opt/homebrew/bin/brew shellenv'));

    const none = { execCommand: () => Promise.resolve({ code: 1, stdout: '', stderr: '' }) };
    assert.strictEqual(await detectShellEnvPrefix(none), '');
  });

  it('putFile / getFile copy through sshUpload / sshDownload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'localssh-'));
    try {
      const src = join(dir, 'a.txt');
      const up = join(dir, 'nested', 'b.txt');
      const down = join(dir, 'c.txt');
      writeFileSync(src, 'payload');

      const ssh = new LocalSsh();
      await sshUpload(ssh, src, up);
      assert.ok(existsSync(up));
      await sshDownload(ssh, up, down); // sshDownload(ssh, remotePath, localPath)
      assert.strictEqual(readFileSync(down, 'utf-8'), 'payload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
