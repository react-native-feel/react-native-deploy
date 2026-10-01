import chalk from 'chalk';

/**
 * EAS's output conventions, because a drop-in replacement that formats
 * differently still breaks anything parsing the output. In `--json` mode nothing
 * but the payload may reach stdout, so every human-facing line goes to stderr.
 */

let jsonMode = false;

export function setJsonMode(enabled) {
  jsonMode = Boolean(enabled);
}

export function isJsonMode() {
  return jsonMode;
}

const out = (line) => {
  if (jsonMode) {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

export const Log = {
  log: (message = '') => out(message),
  newLine: () => out(''),
  succeed: (message) => out(`${chalk.green('✔')} ${message}`),
  fail: (message) => out(`${chalk.red('✖')} ${message}`),
  warn: (message) => out(`${chalk.yellow('⚠')}  ${message}`),
  addNewLineIfNone: () => out(''),
  withTick: (message) => out(`${chalk.green('✔')} ${message}`),
  error: (message) => process.stderr.write(`${chalk.red(message)}\n`),
  debug: (message) => {
    if (process.env.EAS_DEBUG) {
      process.stderr.write(`${chalk.dim(message)}\n`);
    }
  },
};

/** The only thing allowed on stdout when `--json` is set. */
export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function link(url) {
  return chalk.underline.cyan(url);
}

/** EAS renders durations as `6m 45s` / `< 1s`; the dashboard reuses this format. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return '—';
  }
  if (seconds < 1) {
    return '< 1s';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

/** Relative time, matching the "1w ago" / "11 days ago" the dashboard shows. */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) {
    return '—';
  }
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const units = [
    ['y', 31536000],
    ['mo', 2592000],
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) {
      return `${Math.floor(seconds / size)}${label} ago`;
    }
  }
  return 'just now';
}

export class CommandError extends Error {}

/** Exits the way EAS does: message on stderr, non-zero code, no stack trace. */
export function die(message) {
  Log.error(message);
  process.exit(1);
}
