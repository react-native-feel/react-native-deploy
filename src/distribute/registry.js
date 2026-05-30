import { logger } from '../utils/logger.js';

// Per-app build registry stored at builds/<slug>/index.json. Each successful
// build prepends a record. Builds are kept forever (no pruning).

export function sanitizeSlug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

// The slug under which a project's builds are grouped. Mirrors what
// distributeBuild uses so `builds list` finds the same bucket prefix.
export function deriveSlug(config, profile) {
  return sanitizeSlug(
    config.app?.slug || profile?.scheme || config.build?.production?.scheme || 'app'
  );
}

export function indexKeyFor(slug) {
  return `builds/${slug}/index.json`;
}

// Reduce a full build metadata blob to the fields the index needs.
export function toIndexRecord(metadata) {
  return {
    id: metadata.id,
    slug: metadata.slug,
    profile: metadata.profile,
    distribution: metadata.distribution,
    artifactKind: metadata.artifactKind,
    scheme: metadata.scheme,
    bundleId: metadata.bundleId,
    version: metadata.version,
    buildNumber: metadata.buildNumber,
    commit: metadata.commit,
    branch: metadata.branch,
    createdAt: metadata.createdAt,
    artifactUrl: metadata.artifactUrl,
    installPageUrl: metadata.installPageUrl,
  };
}

export function parseIndex(raw) {
  if (!raw) return { version: 1, builds: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.builds)) return { version: 1, builds: [] };
    return parsed;
  } catch {
    logger.warn('Build index was corrupt JSON — starting a fresh index.');
    return { version: 1, builds: [] };
  }
}

// Prepend a record into an index object (newest first), de-duping by id.
export function addRecord(index, record) {
  const builds = [record, ...index.builds.filter(b => b.id !== record.id)];
  return { ...index, version: index.version || 1, builds };
}

// Read-modify-write the per-app index in storage. Best-effort: failures here
// must not fail the build, since the artifact is already uploaded.
export async function appendToIndex(storage, slug, metadata) {
  const key = indexKeyFor(slug);
  const raw = await storage.getString(key);
  const index = parseIndex(raw);
  const updated = addRecord(index, toIndexRecord(metadata));
  await storage.putString(JSON.stringify(updated, null, 2), key, {
    contentType: 'application/json',
  });
  logger.debug(`Build index updated: ${key} (${updated.builds.length} builds)`);
  return updated;
}

// Read the index for one app slug. Returns [] when there is none.
export async function readIndex(storage, slug) {
  const raw = await storage.getString(indexKeyFor(slug));
  return parseIndex(raw).builds;
}

// Read and merge indexes across every app slug under builds/.
export async function readAllIndexes(storage) {
  const slugs = await storage.listPrefixes('builds/');
  const all = [];
  for (const slug of slugs) {
    const builds = await readIndex(storage, slug);
    all.push(...builds);
  }
  // newest first
  return all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
