import { NodeSSH } from 'node-ssh';
import { logger } from '../utils/logger.js';

export function buildSshConfig(opts = {}) {
  const {
    host,
    port = 22,
    username = 'ec2-user',
    privateKeyPath,
    password,
  } = opts;

  const config = {
    host,
    port,
    username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };
  if (privateKeyPath) config.privateKeyPath = privateKeyPath;
  if (password) config.password = password;
  return config;
}

// Map a normalized config `host` block to SSH connection options.
// AWS connections are built from runtime state (publicIp + key) by the caller;
// this handles the byo/managed kinds where creds live in config.
export function sshOptsFromHost(host) {
  if (host?.kind === 'macincloud') {
    return {
      host: host.host,
      port: host.port || 22,
      username: host.user,
      password: host.password,
      privateKeyPath: host.privateKey,
    };
  }
  throw new Error(`sshOptsFromHost: unsupported host.kind "${host?.kind}"`);
}

// Accepts either the legacy positional form createSshConnection(host, keyPath, retries)
// or an options object createSshConnection({ host, port, username, password, privateKeyPath, retries }).
export async function createSshConnection(hostOrOpts, privateKeyPath, retries = 3) {
  let opts;
  if (hostOrOpts && typeof hostOrOpts === 'object') {
    opts = { retries, ...hostOrOpts };
  } else {
    opts = { host: hostOrOpts, privateKeyPath, retries };
  }
  const attempts = opts.retries ?? 3;
  const config = buildSshConfig(opts);
  const ssh = new NodeSSH();

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await ssh.connect(config);
      logger.success(`SSH connected to ${config.username}@${config.host}:${config.port}`);
      return ssh;
    } catch (err) {
      if (attempt === attempts) {
        throw new Error(`SSH connection failed after ${attempts} attempts: ${err.message}`);
      }
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(`SSH attempt ${attempt}/${attempts} failed. Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Managed Macs (e.g. MacinCloud) install node/pod/brew under Homebrew, but a
// non-interactive `ssh host cmd` runs a non-login shell that never adds
// /opt/homebrew/bin to PATH. Detect Homebrew and return a shellenv prefix so
// commands resolve those tools. Returns '' when Homebrew isn't found.
export async function detectShellEnvPrefix(ssh) {
  for (const brew of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    const r = await ssh.execCommand(`test -x ${brew} && echo ok`);
    if (r.stdout.trim() === 'ok') return `eval "$(${brew} shellenv)"; `;
  }
  return '';
}

// Wrap an ssh-like object so every execCommand is prefixed (e.g. to set PATH).
// putFile/getFile/dispose pass straight through. No-op when prefix is empty.
export function withCommandPrefix(ssh, prefix) {
  if (!prefix) return ssh;
  return new Proxy(ssh, {
    get(target, prop) {
      if (prop === 'execCommand') {
        return (command, opts) => target.execCommand(`${prefix}${command}`, opts);
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
