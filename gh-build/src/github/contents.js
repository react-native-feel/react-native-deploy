import { gh, parseRepo } from './api.js';

/** Reads a file from the repo at `ref`, or null when it isn't there. */
export async function getFile(repoSlug, path, ref) {
  const { owner, repo } = parseRepo(repoSlug);
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  try {
    const data = await gh.get(`/repos/${owner}/${repo}/contents/${path}${query}`);
    return {
      sha: data.sha,
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
    };
  } catch (err) {
    if (/404/.test(err.message)) return null;
    throw err;
  }
}

/**
 * Creates or updates a file on `branch`. Requires the "workflow" scope when the
 * path is under .github/workflows/ — GitHub rejects it otherwise.
 */
export async function putFile(repoSlug, path, content, { message, branch, sha }) {
  const { owner, repo } = parseRepo(repoSlug);
  try {
    return await gh.put(`/repos/${owner}/${repo}/contents/${path}`, {
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    });
  } catch (err) {
    if (/workflow.*scope|refusing to allow.*workflow/i.test(err.message)) {
      throw new Error(
        `Your GitHub token can't write workflow files. The PAT needs the "workflow" ` +
        `scope in addition to "repo". Run "rn-build login" with a new token.`
      );
    }
    throw err;
  }
}
