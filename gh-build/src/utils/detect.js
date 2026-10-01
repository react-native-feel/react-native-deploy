import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Turns "origin"'s URL into "owner/name" for both SSH and HTTPS remotes. */
export async function detectRepoSlug(dir = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir });
    const url = stdout.trim();
    const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

export async function detectBranch(dir = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Reads whatever the project already declares so setup can propose real
 * defaults instead of empty prompts.
 */
const LOCKFILES = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/**
 * Picks the package manager from the committed lockfile. Getting this wrong
 * means the runner resolves a different dependency tree than you develop
 * against — and skips `patch-package`-style postinstalls that only the real
 * manager wires up.
 */
export function detectPackageManager(dir = process.cwd()) {
  const pkg = readJson(join(dir, 'package.json'));
  const declared = pkg?.packageManager?.split('@')[0];
  if (declared) return declared;

  for (const [file, manager] of LOCKFILES) {
    if (existsSync(join(dir, file))) return manager;
  }
  return 'npm';
}

export function detectApp(dir = process.cwd()) {
  const appJson = readJson(join(dir, 'app.json'));
  const pkg = readJson(join(dir, 'package.json'));
  const expo = appJson?.expo || appJson;

  const hasExpo = !!(pkg?.dependencies?.expo || pkg?.devDependencies?.expo);
  const iosDirCommitted = existsSync(join(dir, 'ios')) && !isGitIgnored(dir, 'ios');

  return {
    name: expo?.name || pkg?.name || '',
    slug: expo?.slug || '',
    bundleId: expo?.ios?.bundleIdentifier || '',
    androidPackage: expo?.android?.package || '',
    scheme: detectScheme(dir) || sanitizeScheme(expo?.name || pkg?.name || ''),
    // "classic" means the native dirs are committed and prebuild must not run.
    buildType: hasExpo && !iosDirCommitted ? 'expo' : 'classic',
    hasExpo,
    packageManager: detectPackageManager(dir),
  };
}

function detectScheme(dir) {
  const iosDir = join(dir, 'ios');
  if (!existsSync(iosDir)) return null;
  try {
    const workspace = readdirSync(iosDir).find((f) => f.endsWith('.xcworkspace'));
    return workspace ? workspace.replace(/\.xcworkspace$/, '') : null;
  } catch {
    return null;
  }
}

function sanitizeScheme(name) {
  return name.replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Expo projects gitignore the generated native dirs, and write that pattern
 * every which way: "ios", "ios/", "/ios", "/ios/". Getting this wrong flips
 * the project between expo and classic, which decides whether the runner runs
 * `expo prebuild` at all.
 */
export function isGitIgnored(dir, path) {
  try {
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8');
    return gitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .some((line) => line.replace(/^\//, '').replace(/\/$/, '') === path);
  } catch {
    return false;
  }
}
