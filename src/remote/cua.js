import { readFile, writeFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

// Adapter that makes a cua cloud computer (https://cua.ai) look like a node-ssh
// connection, so the existing build/baguette pipeline — which talks to an
// `ssh`-shaped object (execCommand/putFile/getFile/dispose) — works unchanged.
//
// cua's transport is a WebSocket, not SSH. Its interface exposes
// `runCommand(cmd) -> [stdout, stderr]` with NO exit code and NO streaming, plus
// `writeBytes`/`readBytes` for files. We bridge the gaps:
//   - exit codes: wrap each command so the shell prints a sentinel + `$?`, then
//     parse and strip it. Commands are shipped base64-encoded and piped into
//     bash, so arbitrary quoting/here-docs/`&&` chains survive untouched.
//   - streaming: there is none, so onStdout/onStderr fire once with the full
//     output when the command finishes (logs still show, just not live).
//
// Caveat: each execCommand is one blocking runCommand round-trip with no
// intermediate traffic. Short steps (provision checks, the baguette/cloudflared
// preview flow) are fine; a single multi-minute build step relies on cua's
// runCommand not timing out mid-call. If that proves flaky, switch the build to
// a detached "nohup … >log &" + poll-the-log pattern (like the preview tunnel).

export const EXIT_SENTINEL = '__RND_CUA_EXIT__';

function singleQuote(value) {
  // Wrap in single quotes, escaping embedded single quotes the POSIX way.
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Build the shell script for one execCommand call: env exports, optional cwd,
// then the raw command (which may itself contain `cd … &&`, here-docs, etc.).
export function composeScript(command, { cwd, env } = {}) {
  const parts = [];
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) parts.push(`export ${k}=${singleQuote(v)}`);
  }
  if (cwd) parts.push(`cd ${singleQuote(cwd)}`);
  parts.push(command);
  return parts.join('\n');
}

// Turn a command into the runCommand payload that captures the exit code.
export function wrapForExit(command, opts) {
  const script = composeScript(command, opts);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  // base64 has no shell-special chars, so it needs no quoting. `$?` is the exit
  // status of the piped bash, captured before anything else runs.
  return `echo ${b64} | base64 -d | bash; printf '${EXIT_SENTINEL}%s' "$?"`;
}

// Split runCommand stdout back into real stdout + the parsed exit code.
export function parseExit(rawStdout = '') {
  const idx = rawStdout.lastIndexOf(EXIT_SENTINEL);
  if (idx === -1) return { stdout: rawStdout, code: 0 };
  const code = parseInt(rawStdout.slice(idx + EXIT_SENTINEL.length), 10);
  return {
    stdout: rawStdout.slice(0, idx),
    code: Number.isFinite(code) ? code : 1,
  };
}

// Wrap a cua "computer" (anything exposing `interface.runCommand` /
// `interface.writeBytes` / `interface.readBytes` and `disconnect`) as an
// ssh-like object. Exported separately so it can be unit-tested with a fake.
export function makeCuaSsh(computer) {
  const iface = computer.interface;

  return {
    async execCommand(command, opts = {}) {
      const { onStdout, onStderr } = opts;
      logger.debug(`cua> ${command}`);
      const [rawStdout, rawStderr] = await iface.runCommand(wrapForExit(command, opts));
      const { stdout, code } = parseExit(rawStdout ?? '');
      const stderr = rawStderr ?? '';
      if (onStdout && stdout) onStdout(Buffer.from(stdout));
      if (onStderr && stderr) onStderr(Buffer.from(stderr));
      return { code, stdout, stderr, signal: null };
    },

    async putFile(localPath, remotePath) {
      const buf = await readFile(localPath);
      await iface.writeBytes(remotePath, buf);
    },

    async getFile(localPath, remotePath) {
      const buf = await iface.readBytes(remotePath);
      await writeFile(localPath, buf);
    },

    dispose() {
      // node-ssh's dispose is sync/fire-and-forget; mirror that.
      Promise.resolve(computer.disconnect?.()).catch(() => {});
    },
  };
}

// Lazily import the optional @trycua/computer dependency and connect a cloud
// macOS sandbox. Kept as the default so callers don't pull the SDK in tests.
async function defaultConnect(host) {
  let mod;
  try {
    mod = await import('@trycua/computer');
  } catch {
    throw new Error(
      'The cua host needs the "@trycua/computer" package. Install it with:\n' +
      '  npm install @trycua/computer'
    );
  }
  const { Computer } = mod;
  if (!host.apiKey) {
    throw new Error('cua host is missing an apiKey (set the CUA_API_KEY env var).');
  }
  const computer = new Computer({
    name: host.name,
    osType: host.osType || 'macos',
    apiKey: host.apiKey,
  });
  logger.info(`Connecting to cua sandbox "${host.name}" (${host.osType || 'macos'})...`);
  await computer.run();
  logger.success(`cua sandbox "${host.name}" connected`);
  return computer;
}

// Create an ssh-like connection backed by a cua sandbox. `connect` is injectable
// so the wiring can be tested without the network or the SDK.
export async function createCuaConnection(host, { connect = defaultConnect } = {}) {
  const computer = await connect(host);
  return makeCuaSsh(computer);
}
