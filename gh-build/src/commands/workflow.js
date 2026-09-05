import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { WORKFLOW_PATH } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import { getFile, putFile } from '../github/contents.js';
import { logger } from '../utils/logger.js';
import { confirm } from '../utils/prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, '../../templates/rn-build.yml');

export function workflowTemplate() {
  return readFileSync(TEMPLATE, 'utf-8');
}

/** Writes the workflow into the local checkout for the user to commit. */
export function writeWorkflowLocally(dir = process.cwd()) {
  const dest = join(dir, WORKFLOW_PATH);
  mkdirSync(dirname(dest), { recursive: true });
  const existed = existsSync(dest);
  writeFileSync(dest, workflowTemplate());
  return { path: dest, overwritten: existed };
}

export async function workflowInitCommand(options = {}) {
  const { path, overwritten } = writeWorkflowLocally();
  logger.success(`${overwritten ? 'Updated' : 'Wrote'} ${chalk.cyan(WORKFLOW_PATH)}`);
  logger.plain();
  logger.plain('Commit and push it before your first build:');
  logger.dim(`  git add ${WORKFLOW_PATH} && git commit -m "ci: add rn-build workflow" && git push`);

  if (options.push) {
    await workflowPushCommand({ yes: options.yes });
  }
  return path;
}

/**
 * Commits the workflow straight to the configured branch via the API. This
 * writes to a remote repository, so it always confirms unless --yes.
 */
export async function workflowPushCommand(options = {}) {
  const config = loadConfig();
  const { repo, ref } = config.github;
  const content = workflowTemplate();

  const existing = await getFile(repo, WORKFLOW_PATH, ref);

  if (existing?.content === content) {
    logger.success(`${WORKFLOW_PATH} on ${repo}@${ref} is already up to date.`);
    return;
  }

  const action = existing ? 'Update' : 'Add';
  if (!options.yes) {
    logger.plain();
    logger.warn(`This commits directly to ${chalk.bold(`${repo}@${ref}`)}.`);
    const ok = await confirm(`${action} ${WORKFLOW_PATH} on that branch?`, false);
    if (!ok) {
      logger.info('Skipped. Commit the file yourself, or re-run with --yes.');
      return;
    }
  }

  await putFile(repo, WORKFLOW_PATH, content, {
    message: `ci: ${action.toLowerCase()} rn-build workflow`,
    branch: ref,
    sha: existing?.sha,
  });

  logger.success(`${action}d ${WORKFLOW_PATH} on ${repo}@${ref}`);
}

/** Pre-flight for `build`: the workflow must exist on the ref being dispatched. */
export async function assertWorkflowPresent(repo, ref) {
  const file = await getFile(repo, WORKFLOW_PATH, ref);
  if (!file) {
    throw new Error(
      `${WORKFLOW_PATH} is not on ${repo}@${ref} yet — GitHub can only dispatch a ` +
      `workflow that exists on the branch.\n` +
      `  Commit it yourself, or run: rn-build workflow push`
    );
  }
  if (file.content !== workflowTemplate()) {
    logger.warn(
      `${WORKFLOW_PATH} on ${ref} differs from this rn-build version. ` +
      `Run "rn-build workflow push" to sync it if the build behaves unexpectedly.`
    );
  }
}
