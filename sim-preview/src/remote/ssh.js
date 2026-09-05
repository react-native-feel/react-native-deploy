import { NodeSSH } from 'node-ssh';
import { logger } from '../utils/logger.js';

export function buildSshConfig(host, privateKeyPath, { username = 'admin', password, port } = {}) {
  const config = {
    host,
    username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };

  if (port) {
    config.port = Number(port);
  }

  if (privateKeyPath) {
    config.privateKeyPath = privateKeyPath;
  } else if (password) {
    config.password = password;
  }

  return config;
}

export async function connectWithRetry(host, privateKeyPath, { username, password, port, retries = 5 } = {}) {
  const config = buildSshConfig(host, privateKeyPath, { username, password, port });
  const ssh = new NodeSSH();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`SSH attempt ${attempt}/${retries} to ${config.username}@${host}`);
      await ssh.connect(config);
      logger.success(`SSH connected to ${config.username}@${host}`);
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
    const details = [
      result.stderr && `stderr: ${result.stderr}`,
      result.stdout && `stdout: ${result.stdout}`,
    ].filter(Boolean).join('\n') || '(no output)';
    throw new Error(`Command failed (exit ${result.code}): ${command}\n${details}`);
  }
  return result;
}
