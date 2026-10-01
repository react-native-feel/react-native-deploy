import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * The App Store half of `eas submit`, driven by the `asc` CLI.
 *
 * EAS's submit profile already carries every field App Store Connect needs —
 * `ascAppId`, the API key triple, TestFlight `groups`, `language`. The work here
 * is translating those names onto asc's flags and turning its JSON back into
 * something the submission record can hold.
 */

export class AscError extends Error {}

export function ascAvailable() {
  const result = spawnSync('asc', ['--version'], { encoding: 'utf-8' });
  return result.status === 0;
}

/**
 * Runs asc, streaming its output when the caller asked to see it.
 *
 * Uploads take minutes and print progress; swallowing that until the process
 * exits makes a working submission look like a hang.
 */
export function runAsc(args, { env = {}, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('asc', args, {
      env: { ...process.env, ...env },
      stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));

    child.on('error', (err) => {
      reject(
        new AscError(
          err.code === 'ENOENT'
            ? 'The "asc" CLI is not installed. It handles every App Store Connect call in this replacement — install it and run "asc auth login".'
            : `Failed to run asc: ${err.message}`
        )
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AscError(`asc ${args[0]} ${args[1] ?? ''} failed (exit ${code}):\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** asc defaults to JSON output, but being explicit keeps us safe from a default change. */
async function ascJson(args, options) {
  const { stdout } = await runAsc([...args, '--output', 'json'], options);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new AscError(`Could not parse asc output as JSON:\n${stdout.slice(0, 500)}`);
  }
}

/**
 * Turns the submit profile's credential fields into the environment asc reads.
 *
 * EAS resolves `$ASC_API_KEY_PATH`-style indirection before we get here, so
 * these are concrete values by now — but they may still be absent, in which case
 * asc falls back to whatever `asc auth login` stored in the keychain. That
 * fallback is the common case for a developer machine.
 */
export function ascEnvFromProfile(profile) {
  const env = {};
  if (profile.ascApiKeyId) env.ASC_KEY_ID = profile.ascApiKeyId;
  if (profile.ascApiKeyIssuerId) env.ASC_ISSUER_ID = profile.ascApiKeyIssuerId;
  if (profile.ascApiKeyPath) {
    if (!existsSync(profile.ascApiKeyPath)) {
      throw new AscError(
        `ascApiKeyPath points at "${profile.ascApiKeyPath}", which does not exist.`
      );
    }
    env.ASC_PRIVATE_KEY_PATH = profile.ascApiKeyPath;
  }
  return env;
}

/**
 * Resolves the numeric App Store Connect app id.
 *
 * `ascAppId` in the profile wins. Otherwise we look the app up by bundle id,
 * which is what a user expects when their eas.json only names the bundle — and
 * failing with "no app found for com.foo.bar" is far more useful than asc's
 * "app is required".
 */
export async function resolveAscAppId({ profile, bundleIdentifier, env }) {
  if (profile.ascAppId) {
    return profile.ascAppId;
  }
  const identifier = profile.bundleIdentifier ?? bundleIdentifier;
  if (!identifier) {
    throw new AscError(
      'Could not determine which App Store Connect app to submit to. Set "ascAppId" on the ' +
        'submit profile in eas.json, or "ios.bundleIdentifier" in your app config.'
    );
  }
  const apps = await ascJson(['apps', 'list', '--paginate'], { env });
  const list = Array.isArray(apps) ? apps : (apps.data ?? []);
  const match = list.find(
    (app) => (app.attributes?.bundleId ?? app.bundleId) === identifier
  );
  if (!match) {
    throw new AscError(
      `No App Store Connect app found with bundle id "${identifier}". ` +
        'Create the app record first, or set "ascAppId" on the submit profile.'
    );
  }
  return match.id;
}

/**
 * Uploads a binary and, optionally, waits for App Store Connect to finish
 * processing it.
 *
 * `--wait` matters more than it looks: without it the command returns while the
 * build is still "Processing", and any follow-up step that adds TestFlight
 * groups will fail because the build does not exist yet as far as the API is
 * concerned.
 */
export async function uploadBuild({ appId, ipaPath, whatToTest, language, wait, env, stream = true }) {
  const args = ['builds', 'upload', '--app', appId, '--ipa', ipaPath];
  if (whatToTest) {
    args.push('--test-notes', whatToTest, '--locale', language ?? 'en-US');
  }
  if (wait) {
    args.push('--wait');
  }
  await runAsc(args, { env, stream });
}

/** Adds the uploaded build to the TestFlight groups the profile names. */
export async function addToTestFlightGroups({ appId, groups, env }) {
  if (!groups?.length) {
    return [];
  }
  const available = await ascJson(['testflight', 'groups', 'list', '--app', appId], { env });
  const list = Array.isArray(available) ? available : (available.data ?? []);

  const resolved = [];
  for (const name of groups) {
    const match = list.find(
      (group) => group.attributes?.name === name || group.name === name || group.id === name
    );
    if (!match) {
      const names = list.map((g) => g.attributes?.name ?? g.name).filter(Boolean);
      throw new AscError(
        `TestFlight group "${name}" does not exist on this app. Available groups: ${names.join(', ') || '(none)'}`
      );
    }
    await runAsc(['builds', 'add-groups', '--app', appId, '--latest', '--group', match.id], { env });
    resolved.push({ id: match.id, name: match.attributes?.name ?? match.name ?? name });
  }
  return resolved;
}

/** The live version plus recent TestFlight builds, for `eas submit:status`. */
export async function appStoreStatus({ appId, env }) {
  const [builds, versions] = await Promise.all([
    ascJson(['builds', 'list', '--app', appId, '--limit', '10'], { env }),
    ascJson(['versions', 'list', '--app', appId, '--limit', '5'], { env }).catch(() => null),
  ]);
  return { builds, versions };
}
