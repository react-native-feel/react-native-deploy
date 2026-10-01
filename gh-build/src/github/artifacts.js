import { mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gh, parseRepo } from './api.js';
import { run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

export async function listRunArtifacts(repoSlug, runId) {
  const { owner, repo } = parseRepo(repoSlug);
  const data = await gh.get(`/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`);
  return data.artifacts || [];
}

/**
 * Artifacts always arrive zipped, even for a single .ipa. We unzip into the
 * destination and return the installable files we recognise.
 */
export async function downloadArtifact(repoSlug, artifact, destDir) {
  const { owner, repo } = parseRepo(repoSlug);
  const res = await gh.get(
    `/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
    { raw: true }
  );

  const buffer = Buffer.from(await res.arrayBuffer());
  const zipPath = join(tmpdir(), `rn-build-${artifact.id}.zip`);
  writeFileSync(zipPath, buffer);

  mkdirSync(destDir, { recursive: true });
  try {
    await run('unzip', ['-o', '-q', zipPath, '-d', destDir]);
  } finally {
    rmSync(zipPath, { force: true });
  }

  const files = readdirSync(destDir)
    .filter((f) => /\.(ipa|apk|aab)$/i.test(f))
    .map((f) => {
      const path = join(destDir, f);
      return { path, name: f, size: statSync(path).size };
    });

  logger.debug(`unzipped ${artifact.name} → ${files.length} installable(s)`);
  return files;
}

export function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
