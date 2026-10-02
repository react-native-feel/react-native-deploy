/**
 * Generates reference/commands.md from the CLI's own command table.
 *
 * eas/src/cli/spec.js is the same table the contract tests hold against
 * eas-cli's manifest, so generating from it means the reference cannot drift
 * from what the CLI accepts. Its descriptions are eas-cli's wording on purpose;
 * NOTES below says what each command does in this replacement.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS, UNSUPPORTED } from '../../eas/src/cli/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What the command does in rnd, where that differs from or adds to EAS. */
const NOTES = {
  build:
    'Resolves the profile from `eas.json`, checks it can be built, and dispatches `.github/workflows/eas-build.yml` on GitHub Actions. iOS runs on `macos-26`, Android on `ubuntu-latest`. Internal builds are published to the [install service](/guide/internal-distribution) when it is configured. `--local` is refused: the point is that the Mac is GitHub\'s. See [Building](/guide/building).',
  'build:list':
    'Reads workflow runs from the GitHub Actions API and maps each onto EAS\'s `BuildFragment` shape, so `--json` output can be piped into anything that understood EAS. Build ids are a SHA-256 of `repo#runId`, formatted as a UUID.',
  'build:view': 'Accepts a full build id, a unique id prefix, or a raw GitHub run id.',
  'build:cancel': 'Cancels the workflow run, which also stops the runner minutes being billed.',
  'build:download':
    'Downloads the build\'s artifact zip into `./build`. Without `--build-id` it takes the latest build for `--platform`. GitHub always wraps artifacts in a zip: unzip it to get the `.ipa`, `.apk`, `.aab` or simulator `.tar.gz`.',
  'build:configure':
    'Writes a starter `eas.json` and `.github/workflows/eas-build.yml`. It does not set `ios.bundleIdentifier` or `android.package`; add them to `app.json` yourself. Commit and push the workflow before the first build.',
  'build:version:get': 'Reads `ios.buildNumber` and `android.versionCode` from `app.json`; there is no version server.',
  'build:version:set':
    'Refused: versions live in your app config, not on a server. Edit `version`, `ios.buildNumber` and `android.versionCode` in `app.json`.',
  submit:
    'Uploads a local `.ipa` to App Store Connect with `asc builds upload`, waits for processing when TestFlight groups are requested, then adds the build to the profile\'s `groups`. `--url` is refused (asc uploads local files) and Android submission is not wired up yet. See [Submitting to TestFlight](/guide/submit).',
  'submit:list': 'Submission history is not stored locally; this shows recent TestFlight builds from App Store Connect.',
  'submit:view': 'Shows recent TestFlight builds from App Store Connect.',
  'submit:status': 'The live App Store version and recent TestFlight builds with their processing state.',
  'submit:cancel':
    'Refused: an App Store Connect upload cannot be cancelled once started. Remove the build from its TestFlight groups instead.',
  credentials:
    'Reports which signing secrets the repository holds. It does not create or upload them yet; see [Credentials](/guide/credentials) for the setup.',
  config: 'Prints the build and submit profile after `extends`, platform blocks and schema defaults are applied: what the runner actually receives.',
  'project:info': 'What the CLI sees: app identifiers, GitHub repository, branch, managed vs bare, lockfile, and whether `eas.json` exists.',
  'device:list': 'Lists devices registered on your Apple Developer account through `asc`, with name, model and UDID.',
  'device:create':
    'Prints the `asc devices create` command to run. After registering a device, regenerate the ad-hoc profile and rebuild. See [Internal distribution](/guide/internal-distribution#adding-a-device).',
  'account:view': 'Shows the GitHub user the stored token belongs to, and its scopes.',
  'account:login':
    'Stores a GitHub personal access token (scopes `repo` and `workflow`) at `~/.eas-gh/auth.json`, mode 0600. Reads `EAS_GITHUB_TOKEN` when set, otherwise prompts. There is no Expo account, SSO or browser flow.',
  'account:logout': 'Deletes the stored token. A token in `EAS_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN` is still used.',
};

/**
 * Flags accepted for eas-cli compatibility that the handler does not act on yet.
 * Listed so the reference never implies behaviour that isn't there.
 */
const NO_EFFECT = {
  build: [
    'auto-submit',
    'auto-submit-with-profile',
    'what-to-test',
    'build-logger-level',
    'freeze-credentials',
    'refresh-ad-hoc-provisioning-profile',
    'verbose-logs',
  ],
};

const GROUPS = [
  ['Build', (id) => id === 'build' || id.startsWith('build:')],
  ['Submit', (id) => id === 'submit' || id.startsWith('submit:')],
  ['Project & credentials', (id) => ['credentials', 'config', 'project:info'].includes(id)],
  ['Devices', (id) => id.startsWith('device:')],
  ['Account', (id) => id.startsWith('account:')],
];

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function flagName(flag) {
  const long = flag.type === 'boolean' && flag.allowNo ? `--[no-]${flag.name}` : `--${flag.name}`;
  const value = flag.type === 'option' ? (flag.options ? ` <${flag.options.join('|')}>` : ' <value>') : '';
  // Pipes must be escaped even inside a code span, or they split the table cell.
  return `\`${flag.char ? `-${flag.char}, ` : ''}${long}${value}\``.replace(/\|/g, '\\|');
}

function usage(command) {
  const args = (command.args ?? []).map((a) => `[${typeof a === 'string' ? a : a.name}]`);
  return ['rnd', command.id, ...args, (command.flags ?? []).length ? '[flags]' : ''].filter(Boolean).join(' ');
}

function anchor(id) {
  return `eas-${id.replace(/:/g, '-')}`;
}

function renderCommand(command) {
  const lines = [`### \`rnd ${command.id}\` {#${anchor(command.id)}}`, ''];
  if (command.aliases?.length) {
    lines.push(`Alias: ${command.aliases.map((a) => `\`rnd ${a}\``).join(', ')}`, '');
  }
  lines.push(`> ${command.description}`, '');
  if (NOTES[command.id]) {
    lines.push(`**In rnd:** ${NOTES[command.id]}`, '');
  }
  lines.push('```sh', usage(command), '```', '');
  const flags = command.flags ?? [];
  if (flags.length) {
    lines.push('| Flag | Default | Description |', '|---|---|---|');
    for (const flag of flags) {
      const def = flag.default === undefined ? '' : `\`${JSON.stringify(flag.default)}\``;
      const description = cell(flag.description).replace(/([^.])$/, '$1.');
      const aliases = flag.aliases?.length ? ` Alias: ${flag.aliases.map((a) => `\`--${a}\``).join(', ')}.` : '';
      const ignored = (NO_EFFECT[command.id] ?? []).includes(flag.name)
        ? ' <Badge type="warning" text="accepted, no effect yet" />'
        : '';
      lines.push(`| ${flagName(flag)} | ${def} | ${description}${aliases}${ignored} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const sections = GROUPS.map(([title, match]) => {
  const commands = COMMANDS.filter((c) => match(c.id));
  return `## ${title}\n\n${commands.map(renderCommand).join('\n')}`;
});

const unsupported = Object.entries(UNSUPPORTED)
  .map(([id, reason]) => `| \`rnd ${id}\` | ${cell(reason)} |`)
  .join('\n');

const page = `---
outline: [2, 3]
---

<!-- Generated by scripts/gen-commands.mjs from eas/src/cli/spec.js. Do not edit by hand. -->

# Command reference

Every command below takes the same flags as \`eas-cli\`: a contract test compares this
table with \`eas-cli\`'s own \`oclif.manifest.json\`. The quoted line is \`eas-cli\`'s
description; **In rnd** says what the command does here.

Global options: \`--help\` on any command, \`--version\` on \`eas\`.

${sections.join('\n\n')}

## Not supported

These commands describe services that only exist on Expo's servers. They are recognised and
answered with the alternative, rather than failing as an unknown command.

| Command | Why, and what to use instead |
|---|---|
${unsupported}
`;

const target = join(root, 'reference', 'commands.md');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, page);
console.log(`wrote ${target} (${COMMANDS.length} commands, ${Object.keys(UNSUPPORTED).length} unsupported)`);
