import { NodeSSH } from 'node-ssh';
import { logger } from '../utils/logger.js';

export function buildSshConfig(host, privateKeyPath, username = 'ec2-user') {
  return {
    host,
    username,
    privateKeyPath,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };
}

export async function createSshConnection(host, privateKeyPath, retries = 3) {
  const config = buildSshConfig(host, privateKeyPath);
  const ssh = new NodeSSH();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await ssh.connect(config);
      logger.success(`SSH connected to ${host}`);
      return ssh;
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`SSH connection failed after ${retries} attempts: ${err.message}`);
      }
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(`SSH attempt ${attempt}/${retries} failed. Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export async function sshExec(ssh, command, { stream = false, cwd, env } = {}) {
  logger.debug(`> ${command}`);

  if (stream) {
    return new Promise((resolve, reject) => {
      ssh.execCommand(command, {
        cwd,
        env,
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
      }).then(result => {
        if (result.code !== 0) {
          reject(new Error(`Command failed (exit ${result.code}): ${command}`));
        } else {
          resolve(result);
        }
      }).catch(reject);
    });
  }

  const result = await ssh.execCommand(command, { cwd, env });
  if (result.code !== 0) {
    throw new Error(`Command failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

export async function sshUpload(ssh, localPath, remotePath) {
  logger.debug(`Uploading ${localPath} -> ${remotePath}`);
  await ssh.putFile(localPath, remotePath);
}

export async function sshDownload(ssh, remotePath, localPath) {
  logger.debug(`Downloading ${remotePath} -> ${localPath}`);
  await ssh.getFile(localPath, remotePath);
}
