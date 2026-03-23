import { NodeSSH } from 'node-ssh';
import { logger } from '../utils/logger.js';

export function buildSshConfig(host, privateKeyPath) {
  return {
    host,
    username: 'ec2-user',
    privateKeyPath,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };
}

export async function connectWithRetry(host, privateKeyPath, retries = 5) {
  const config = buildSshConfig(host, privateKeyPath);
  const ssh = new NodeSSH();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`SSH attempt ${attempt}/${retries} to ${host}`);
      await ssh.connect(config);
      logger.success(`SSH connected to ${host}`);
      return ssh;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      logger.debug(`SSH failed, retrying in ${delay / 1000}s: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function sshExec(ssh, command, { stream = false, cwd } = {}) {
  logger.debug(`> ${command}`);
  if (stream) {
    const result = await ssh.execCommand(command, {
      cwd,
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (result.code !== 0) throw new Error(`Command failed (exit ${result.code}): ${command}`);
    return result;
  }

  const result = await ssh.execCommand(command, { cwd });
  if (result.code !== 0) {
    throw new Error(`Command failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}
