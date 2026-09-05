import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AUTH_DIR = join(homedir(), '.rn-build');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

/**
 * Token resolution order: env var (CI-friendly) → ~/.rn-build/auth.json.
 * The token is never written into the project directory, so a config file
 * can be committed without leaking credentials.
 */
export function getToken() {
  const fromEnv = process.env.RN_BUILD_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;

  if (existsSync(AUTH_FILE)) {
    try {
      const { token } = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
      if (token) return token;
    } catch {
      // fall through to the error below
    }
  }
  return null;
}

export function requireToken() {
  const token = getToken();
  if (!token) {
    throw new Error(
      'No GitHub token found. Run "rn-build login" or set RN_BUILD_GITHUB_TOKEN.'
    );
  }
  return token;
}

export function saveToken(token) {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  chmodSync(AUTH_FILE, 0o600);
  return AUTH_FILE;
}

export function clearToken() {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, JSON.stringify({}, null, 2), { mode: 0o600 });
    return true;
  }
  return false;
}

export const authFilePath = AUTH_FILE;

/** Scopes a classic PAT needs to write workflow files, set secrets, and dispatch. */
export const REQUIRED_SCOPES = ['repo', 'workflow'];
