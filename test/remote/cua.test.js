import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeScript,
  wrapForExit,
  parseExit,
  makeCuaSsh,
  createCuaConnection,
  EXIT_SENTINEL,
} from '../../src/remote/cua.js';

describe('composeScript', () => {
  it('emits the bare command when no cwd/env', () => {
    assert.strictEqual(composeScript('echo hi'), 'echo hi');
  });

  it('prepends env exports then cwd, then the command', () => {
    const script = composeScript('xcodebuild', { cwd: '/w', env: { A: '1', B: 'two' } });
    assert.strictEqual(script, "export A='1'\nexport B='two'\ncd '/w'\nxcodebuild");
  });

  it('single-quotes values containing quotes safely', () => {
    const script = composeScript('run', { env: { K: "a'b" } });
    assert.strictEqual(script, "export K='a'\\''b'\nrun");
  });
});

describe('wrapForExit', () => {
  it('base64-encodes the script and prints the sentinel with $?', () => {
    const wrapped = wrapForExit('echo hi');
    const b64 = Buffer.from('echo hi', 'utf8').toString('base64');
    assert.ok(wrapped.includes(`echo ${b64} | base64 -d | bash`));
    assert.ok(wrapped.includes(`printf '${EXIT_SENTINEL}%s' "$?"`));
  });
});

describe('parseExit', () => {
  it('returns code 0 and untouched stdout when no sentinel', () => {
    assert.deepStrictEqual(parseExit('plain output'), { stdout: 'plain output', code: 0 });
  });

  it('splits stdout and parses a non-zero exit code', () => {
    assert.deepStrictEqual(parseExit(`build log${EXIT_SENTINEL}65`), { stdout: 'build log', code: 65 });
  });

  it('treats a non-numeric exit marker as failure', () => {
    assert.strictEqual(parseExit(`x${EXIT_SENTINEL}`).code, 1);
  });
});

function fakeComputer({ runCommand, writeBytes, readBytes } = {}) {
  const calls = { commands: [], writes: [], reads: [], disconnected: 0 };
  return {
    calls,
    interface: {
      async runCommand(cmd) {
        calls.commands.push(cmd);
        return runCommand ? runCommand(cmd) : ['', ''];
      },
      async writeBytes(path, buf) {
        calls.writes.push({ path, buf });
        if (writeBytes) writeBytes(path, buf);
      },
      async readBytes(path) {
        calls.reads.push(path);
        return readBytes ? readBytes(path) : Buffer.from('');
      },
    },
    async disconnect() { calls.disconnected += 1; },
  };
}

describe('makeCuaSsh.execCommand', () => {
  it('parses stdout + exit code from runCommand output', async () => {
    const computer = fakeComputer({ runCommand: () => [`done${EXIT_SENTINEL}0`, ''] });
    const ssh = makeCuaSsh(computer);
    const r = await ssh.execCommand('echo done');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, 'done');
  });

  it('surfaces non-zero exit codes (so sshExec can throw)', async () => {
    const computer = fakeComputer({ runCommand: () => [`oops${EXIT_SENTINEL}2`, 'err'] });
    const ssh = makeCuaSsh(computer);
    const r = await ssh.execCommand('false');
    assert.strictEqual(r.code, 2);
    assert.strictEqual(r.stderr, 'err');
  });

  it('invokes onStdout for streaming callers', async () => {
    const computer = fakeComputer({ runCommand: () => [`live${EXIT_SENTINEL}0`, ''] });
    const ssh = makeCuaSsh(computer);
    let captured = '';
    await ssh.execCommand('x', { onStdout: (c) => { captured += c.toString(); } });
    assert.strictEqual(captured, 'live');
  });
});

describe('makeCuaSsh file transfer', () => {
  it('putFile reads local bytes and writes them via the interface', async () => {
    const local = join(tmpdir(), `rnd-cua-put-${process.pid}.bin`);
    await writeFile(local, 'payload');
    const computer = fakeComputer();
    const ssh = makeCuaSsh(computer);
    await ssh.putFile(local, '/remote/x');
    assert.strictEqual(computer.calls.writes[0].path, '/remote/x');
    assert.strictEqual(computer.calls.writes[0].buf.toString(), 'payload');
    await rm(local, { force: true });
  });

  it('getFile reads remote bytes and writes them locally', async () => {
    const local = join(tmpdir(), `rnd-cua-get-${process.pid}.bin`);
    const computer = fakeComputer({ readBytes: () => Buffer.from('remote-bytes') });
    const ssh = makeCuaSsh(computer);
    await ssh.getFile(local, '/remote/y');
    assert.strictEqual((await readFile(local)).toString(), 'remote-bytes');
    await rm(local, { force: true });
  });
});

describe('createCuaConnection', () => {
  it('connects via the injected connector and returns an ssh-like object', async () => {
    const computer = fakeComputer({ runCommand: () => [`ok${EXIT_SENTINEL}0`, ''] });
    const ssh = await createCuaConnection(
      { name: 'sb', apiKey: 'k', osType: 'macos' },
      { connect: async () => computer },
    );
    assert.strictEqual(typeof ssh.execCommand, 'function');
    const r = await ssh.execCommand('echo ok');
    assert.strictEqual(r.stdout, 'ok');
  });
});
