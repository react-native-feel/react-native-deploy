import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a local binary. Throws with combined output on non-zero exit so callers
 * surface the tool's own error text rather than a bare exit code.
 */
export async function run(cmd, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
    return { stdout, stderr };
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${detail || err.message}`);
  }
}

export async function runJson(cmd, args, options = {}) {
  const { stdout } = await run(cmd, args, options);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${cmd} did not return valid JSON:\n${stdout.slice(0, 500)}`);
  }
}

export async function which(cmd) {
  try {
    await execFileAsync('command', ['-v', cmd], { shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

export async function requireBinaries(names) {
  const missing = [];
  for (const name of names) {
    if (!(await which(name))) missing.push(name);
  }
  if (missing.length) {
    throw new Error(
      `Missing required tool(s): ${missing.join(', ')}.\n` +
      `  asc      → brew install asc  (App Store Connect CLI)\n` +
      `  openssl  → preinstalled on macOS/Linux\n` +
      `  keytool  → install a JDK (brew install openjdk@17)\n` +
      `  unzip    → preinstalled on macOS/Linux`
    );
  }
}
