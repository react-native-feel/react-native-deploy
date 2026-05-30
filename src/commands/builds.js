import { loadConfig } from '../config/loader.js';
import { resolveProfile } from '../config/profiles.js';
import { createStorageAdapter } from '../storage/index.js';
import { deriveSlug, readIndex, readAllIndexes } from '../distribute/registry.js';
import { logger } from '../utils/logger.js';

// Fetch the build records for `builds list` / `install`. Shared so both
// commands resolve storage + slug the same way.
export async function fetchBuilds({ all = false } = {}) {
  const config = loadConfig();
  if (!config.storage) {
    throw new Error(
      'No storage configured. Add a "storage" block to deploy.config.json to use the build registry.'
    );
  }
  const storage = createStorageAdapter(config.storage);

  let builds, slug = null;
  if (all) {
    builds = await readAllIndexes(storage);
  } else {
    let profile = null;
    try { profile = resolveProfile(config.build || {}, 'production'); } catch { /* optional */ }
    slug = deriveSlug(config, profile);
    builds = await readIndex(storage, slug);
  }
  return { config, storage, builds, slug };
}

export async function buildsListCommand(options = {}) {
  const { builds } = await fetchBuilds({ all: options.all });
  if (builds.length === 0) {
    logger.info('No builds found in the registry yet.');
    return;
  }
  printBuildsTable(builds);
}

export function printBuildsTable(builds, { now } = {}) {
  const rows = builds.map((b, i) => ({
    '#': String(i + 1),
    VERSION: b.version || '—',
    BUILD: b.buildNumber || '—',
    PROFILE: b.profile || '—',
    DIST: b.distribution || '—',
    COMMIT: b.commit || '—',
    AGE: relativeAge(b.createdAt, now),
    ID: (b.id || '').slice(0, 8),
  }));

  const cols = ['#', 'VERSION', 'BUILD', 'PROFILE', 'DIST', 'COMMIT', 'AGE', 'ID'];
  const widths = {};
  for (const c of cols) {
    widths[c] = Math.max(c.length, ...rows.map(r => r[c].length));
  }
  const fmt = (r) => cols.map(c => r[c].padEnd(widths[c])).join('  ');

  process.stdout.write(fmt(Object.fromEntries(cols.map(c => [c, c]))) + '\n');
  for (const r of rows) process.stdout.write(fmt(r) + '\n');
}

export function relativeAge(iso, now = Date.now()) {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
