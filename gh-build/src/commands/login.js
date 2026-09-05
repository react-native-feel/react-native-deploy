import chalk from 'chalk';
import { saveToken, clearToken, getToken, authFilePath, REQUIRED_SCOPES } from '../github/auth.js';
import { getViewer, getTokenScopes } from '../github/api.js';
import { logger } from '../utils/logger.js';
import { secret } from '../utils/prompts.js';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,workflow&description=rn-build';

export async function loginCommand(options = {}) {
  let token = options.token;

  if (!token) {
    logger.plain();
    logger.plain(chalk.bold('rn-build needs a GitHub personal access token.'));
    logger.plain('It uses the token to set repository secrets, commit the build');
    logger.plain('workflow, dispatch runs, and download artifacts.');
    logger.plain();
    logger.plain(`  Scopes required: ${chalk.cyan(REQUIRED_SCOPES.join(', '))}`);
    logger.plain(`  Create one here: ${chalk.underline(TOKEN_URL)}`);
    logger.plain();
    token = await secret('Paste your token:');
  }

  if (!token) throw new Error('No token provided.');

  process.env.RN_BUILD_GITHUB_TOKEN = token;

  const user = await getViewer();
  const scopes = await getTokenScopes();

  if (scopes) {
    const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    if (missing.length) {
      throw new Error(
        `Token is missing the ${missing.join(' and ')} scope(s). ` +
        `Builds will fail when writing the workflow or setting secrets.\n` +
        `Create a new one at ${TOKEN_URL}`
      );
    }
    logger.debug(`token scopes: ${scopes.join(', ')}`);
  } else {
    logger.warn(
      'This looks like a fine-grained token — scopes could not be verified. ' +
      'It needs read/write on Contents, Secrets, Actions, and Workflows.'
    );
  }

  const path = saveToken(token);
  logger.success(`Authenticated as ${chalk.bold(user.login)}`);
  logger.dim(`Token stored at ${path} (mode 0600)`);
}

export async function logoutCommand() {
  const had = clearToken();
  if (had) logger.success(`Token cleared from ${authFilePath}`);
  else logger.info('No stored token to clear.');

  if (process.env.RN_BUILD_GITHUB_TOKEN || process.env.GITHUB_TOKEN) {
    logger.warn('A token is still set in your environment (RN_BUILD_GITHUB_TOKEN / GITHUB_TOKEN).');
  }
}

export async function whoamiCommand() {
  if (!getToken()) {
    logger.info('Not logged in. Run "rn-build login".');
    return;
  }
  const user = await getViewer();
  const scopes = await getTokenScopes();
  logger.success(`${user.login} (${user.html_url})`);
  if (scopes) logger.dim(`scopes: ${scopes.join(', ')}`);
}
