import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Anonymous usage stats: which commands run, which flags they get, on what
 * platform. No paths, profile names, messages, IDs or anything else a user
 * typed — free-text options are reported as "set", never by value.
 *
 * The PostHog key is inlined by scripts/build.mjs, so only the published
 * bundle reports anything; running from source or the tests never does.
 *
 * Opt out with DO_NOT_TRACK=1 or RND_TELEMETRY_DISABLED=1. Telemetry must
 * never slow down or break a command: every request is capped and every error
 * swallowed.
 */

const KEY = typeof __RND_POSTHOG_KEY__ !== 'undefined' ? __RND_POSTHOG_KEY__ : '';
const HOST = typeof __RND_POSTHOG_HOST__ !== 'undefined' ? __RND_POSTHOG_HOST__ : 'https://us.i.posthog.com';
const VERSION = typeof __RND_VERSION__ !== 'undefined' ? __RND_VERSION__ : 'source';
const TIMEOUT_MS = 1500;

const truthy = (value) => value !== undefined && value !== '' && value !== '0' && value !== 'false';

export function telemetryEnabled(env = process.env) {
  return Boolean(KEY) && !truthy(env.DO_NOT_TRACK) && !truthy(env.RND_TELEMETRY_DISABLED);
}

function configDir() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'rnd');
}

/** A random ID per machine, created on first run, so users can be counted without being identified. */
function anonymousId() {
  const file = join(configDir(), 'telemetry.json');
  try {
    return JSON.parse(readFileSync(file, 'utf-8')).id;
  } catch {
    const id = randomUUID();
    try {
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(file, JSON.stringify({ id }));
    } catch {
      // A read-only home still gets counted, just as a new user each run.
    }
    // stderr, so `--json` output stays clean.
    process.stderr.write(
      'rnd collects anonymous usage stats (commands and flags, never values or paths).\n' +
        'Opt out with DO_NOT_TRACK=1. Details: https://reactnativefeel.com/deploy/docs/guide/telemetry\n'
    );
    return id;
  }
}

/**
 * The flags a user actually typed. Booleans and enum options report their
 * value; free-text options report only that they were set.
 */
export function summarizeFlags(spec, command) {
  const flags = {};
  for (const flag of spec.flags) {
    // Old camelCase aliases (`--appVersion`) are separate options, so check those too.
    const key = [flag.name, ...(flag.aliases ?? [])]
      .map((name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))
      .find((k) => command.getOptionValueSource?.(k) === 'cli');
    if (!key) continue;
    const value = command.opts()[key];
    flags[flag.name] = flag.type === 'boolean' || flag.options ? value : true;
  }
  return flags;
}

export async function track(event, properties = {}) {
  if (!telemetryEnabled()) return;
  try {
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: anonymousId(),
        properties: {
          ...properties,
          cli_version: VERSION,
          os: process.platform,
          arch: process.arch,
          node_version: process.version,
          ci: Boolean(process.env.CI),
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Offline, blocked, timed out: none of it is the user's problem.
  }
}
