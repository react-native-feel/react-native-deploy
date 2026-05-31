import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// A local executor shaped like node-ssh's NodeSSH. Because sshExec/sshUpload/
// sshDownload only depend on `.execCommand`, `.putFile`, `.getFile`, this drops
// straight into the existing build pipeline so the same steps that run over SSH
// on a remote Mac can run locally on a CI runner (e.g. a GitHub Actions macOS
// runner) with no changes to the callers.
export class LocalSsh {
  constructor({ cwd } = {}) {
    this.defaultCwd = cwd;
  }

  // Mirrors NodeSSH#execCommand: runs through bash -c so compound commands
  // (cd, &&, pipes) behave the same as on the remote shell.
  execCommand(command, { cwd, onStdout, onStderr } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', command], {
        cwd: cwd || this.defaultCwd || process.cwd(),
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (onStdout) onStdout(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (onStderr) onStderr(chunk);
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr, signal: null });
      });
    });
  }

  // Local "upload"/"download" are just file copies. Signatures match
  // NodeSSH#putFile(local, remote) / NodeSSH#getFile(local, remote).
  async putFile(localPath, remotePath) {
    await mkdir(dirname(remotePath), { recursive: true });
    await copyFile(localPath, remotePath);
  }

  async getFile(localPath, remotePath) {
    if (localPath === remotePath) return;
    await mkdir(dirname(localPath), { recursive: true });
    await copyFile(remotePath, localPath);
  }

  dispose() { /* nothing to clean up */ }
}
