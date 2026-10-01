import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Everything the commands need to know about the project on disk: where its root
 * is, what it is called, which lockfile it uses, and what git says about the
 * current checkout.
 *
 * EAS gets most of this from its servers. We read it locally, which is why the
 * commands work in a fresh clone with no account attached.
 */

const LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];

/** Walks up for the nearest package.json, the same way a bundler resolves a root. */
export function findProjectRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Reads the Expo app config.
 *
 * A static app.json is read directly. An `app.config.js` is *evaluated* by Expo
 * at prebuild time and commonly branches on `process.env.APP_VARIANT`, so its
 * real values cannot be known here — we note that it is dynamic and let the
 * runner resolve it with the profile's env in place. Guessing would be worse
 * than admitting we do not know.
 */
export function readAppConfig(projectRoot) {
  const dynamic = ['app.config.ts', 'app.config.js', 'app.config.mjs'].find((f) =>
    existsSync(join(projectRoot, f))
  );
  const staticConfig = readJson(join(projectRoot, 'app.json'));
  const expo = staticConfig?.expo ?? staticConfig ?? {};
  const pkg = readJson(join(projectRoot, 'package.json')) ?? {};

  return {
    isDynamic: Boolean(dynamic),
    dynamicConfigPath: dynamic ? join(projectRoot, dynamic) : null,
    name: expo.name ?? pkg.name ?? null,
    slug: expo.slug ?? pkg.name ?? null,
    version: expo.version ?? pkg.version ?? null,
    sdkVersion: expo.sdkVersion ?? pkg.dependencies?.expo ?? null,
    scheme: typeof expo.scheme === 'string' ? expo.scheme : null,
    ios: {
      bundleIdentifier: expo.ios?.bundleIdentifier ?? null,
      buildNumber: expo.ios?.buildNumber ?? null,
    },
    android: {
      package: expo.android?.package ?? null,
      versionCode: expo.android?.versionCode ?? null,
    },
    owner: expo.owner ?? null,
    runtimeVersion:
      typeof expo.runtimeVersion === 'string'
        ? expo.runtimeVersion
        : (expo.runtimeVersion?.policy ?? null),
  };
}

/** Which package manager the repo actually commits a lockfile for. */
export function detectLockfiles(projectRoot) {
  return LOCKFILES.filter((name) => existsSync(join(projectRoot, name)));
}

/** True when the project keeps native dirs committed rather than prebuilding. */
export function isBareProject(projectRoot) {
  return existsSync(join(projectRoot, 'ios')) || existsSync(join(projectRoot, 'android'));
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function readGitContext(projectRoot) {
  const status = git(['status', '--porcelain'], projectRoot);
  return {
    commit: git(['rev-parse', 'HEAD'], projectRoot),
    shortCommit: git(['rev-parse', '--short', 'HEAD'], projectRoot),
    message: git(['log', '-1', '--pretty=%B'], projectRoot),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot),
    remote: git(['remote', 'get-url', 'origin'], projectRoot),
    // EAS marks a build from a dirty tree with a trailing `*` on the commit —
    // the artifact does not correspond to anything pushed, which matters when
    // someone later tries to reproduce it.
    isDirty: Boolean(status),
  };
}

/** Turns any git remote spelling into `owner/name`. */
export function parseGitHubRepo(remote) {
  if (!remote) {
    return null;
  }
  const match = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The bundle of context nearly every command opens with. */
export function loadProjectContext(cwd = process.cwd()) {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error(
      'Could not find a package.json in this directory or any parent. Run this from inside your project.'
    );
  }
  const git = readGitContext(projectRoot);
  return {
    projectRoot,
    appConfig: readAppConfig(projectRoot),
    lockfiles: detectLockfiles(projectRoot),
    isBare: isBareProject(projectRoot),
    git,
    repo: parseGitHubRepo(git.remote),
    easJsonPath: join(projectRoot, 'eas.json'),
    hasEasJson: existsSync(join(projectRoot, 'eas.json')),
  };
}
