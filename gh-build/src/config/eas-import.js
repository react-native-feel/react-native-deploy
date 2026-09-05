import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pulls per-profile `env` out of an existing eas.json. An app configured for
 * EAS usually branches on those variables at config-resolution time (an
 * `app.config.js` reading APP_VARIANT, say), so dropping them silently
 * produces a build with the wrong icon, API host, or update channel.
 *
 * Only `env` is imported — the rest of eas.json describes EAS-specific
 * infrastructure that has no meaning here.
 */
export function importEasProfiles(buildProfiles, dir = process.cwd()) {
  const easPath = join(dir, 'eas.json');
  if (!existsSync(easPath)) return [];

  let eas;
  try {
    eas = JSON.parse(readFileSync(easPath, 'utf-8'));
  } catch {
    return [];
  }

  const imported = [];
  for (const [name, profile] of Object.entries(buildProfiles)) {
    const easEnv = eas.build?.[name]?.env;
    if (!easEnv || !Object.keys(easEnv).length) continue;
    profile.env = { ...easEnv, ...(profile.env || {}) };
    imported.push(name);
  }
  return imported;
}
