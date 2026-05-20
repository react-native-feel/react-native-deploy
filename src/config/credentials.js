import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const DEFAULT_PROFILE_NAME = 'rn-deploy';

function ascAvailable() {
  try {
    execFileSync('asc', ['--help'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

export function ascStatus() {
  if (!ascAvailable()) return { available: false };
  try {
    const out = execFileSync('asc', ['auth', 'status', '--output', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return { available: true, ...JSON.parse(out) };
  } catch (err) {
    return { available: true, error: err.message };
  }
}

export function ascAuthLogin({ name = DEFAULT_PROFILE_NAME, keyId, issuerId, privateKeyPath, network = false }) {
  if (!ascAvailable()) {
    throw new Error('asc CLI not installed. Install with: brew install asc');
  }
  const args = ['auth', 'login', '--name', name, '--key-id', keyId, '--issuer-id', issuerId, '--private-key', expandHome(privateKeyPath)];
  if (network) args.push('--network');
  execFileSync('asc', args, { stdio: 'inherit' });
}

export function ascAuthSwitch(name) {
  execFileSync('asc', ['auth', 'switch', '--name', name], { stdio: 'inherit' });
}

export function ascAuthLogout(name) {
  const args = ['auth', 'logout'];
  if (name) args.push('--name', name);
  execFileSync('asc', args, { stdio: 'inherit' });
}

export function ascIssuerId() {
  try {
    return execFileSync('asc', ['auth', 'issuer-id'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

// Resolves ASC credentials for build use. Order:
//   1) Explicit config.asc.{keyId,issuerId,privateKeyPath} (legacy / CI)
//   2) Environment: ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY_PATH
//   3) `asc auth status` — credentials live in macOS keychain (preferred)
// Returns { keyId, issuerId, privateKeyPath, source } or throws.
export function resolveAscCredentials(config) {
  const cfg = config?.asc || {};
  if (cfg.keyId && cfg.issuerId && cfg.privateKeyPath) {
    const p = expandHome(cfg.privateKeyPath);
    if (!existsSync(p)) {
      throw new Error(`asc.privateKeyPath not found: ${p}`);
    }
    return { keyId: cfg.keyId, issuerId: cfg.issuerId, privateKeyPath: p, source: 'config' };
  }

  const env = {
    keyId: process.env.ASC_KEY_ID,
    issuerId: process.env.ASC_ISSUER_ID,
    privateKeyPath: process.env.ASC_PRIVATE_KEY_PATH,
  };
  if (env.keyId && env.issuerId && env.privateKeyPath) {
    const p = expandHome(env.privateKeyPath);
    if (!existsSync(p)) throw new Error(`ASC_PRIVATE_KEY_PATH not found: ${p}`);
    return { ...env, privateKeyPath: p, source: 'env' };
  }

  const status = ascStatus();
  if (status.available && !status.error && status.keyId && status.issuerId) {
    // asc has the key in keychain. We still need the .p8 path locally so we can
    // upload it to the remote Mac. Check the canonical location.
    const candidates = [
      cfg.privateKeyPath,
      status.privateKeyPath,
      '~/.appstoreconnect/AuthKey.p8',
      `~/.appstoreconnect/AuthKey_${status.keyId}.p8`,
      `~/private_keys/AuthKey_${status.keyId}.p8`,
    ].filter(Boolean).map(expandHome);
    const found = candidates.find(p => existsSync(p));
    if (!found) {
      throw new Error(
        `asc keychain has credentials for keyId ${status.keyId} but the .p8 file ` +
        `was not found locally. We need it to upload to the remote build Mac. ` +
        `Place it at ~/.appstoreconnect/AuthKey_${status.keyId}.p8 or set ASC_PRIVATE_KEY_PATH.`
      );
    }
    return {
      keyId: status.keyId,
      issuerId: status.issuerId,
      privateKeyPath: found,
      source: 'keychain',
    };
  }

  throw new Error(
    'No App Store Connect credentials found. Run "rn-deploy credentials configure" to set them up.'
  );
}
