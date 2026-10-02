import { Command, Option } from 'commander';

import { COMMANDS, UNSUPPORTED } from './spec.js';

/**
 * Builds the commander program from the declarative spec, so the surface the
 * tests verify is literally the surface users get — there is no second
 * hand-maintained list to drift.
 *
 * EAS command ids are colon-separated (`build:list`). Commander is
 * space-separated by design, so each id is registered as a single literal
 * command name. That keeps `eas build:list` working exactly as typed, which is
 * what a user's existing scripts and CI configs contain.
 */

function applyFlag(command, flag) {
  const long = `--${flag.name}`;
  const flags = flag.char ? `-${flag.char}, ${long}` : long;

  if (flag.type === 'option') {
    const option = new Option(`${flags} <value>`, flag.description);
    if (flag.options) option.choices(flag.options);
    if (flag.default !== undefined) option.default(flag.default);
    command.addOption(option);
    // EAS accepts camelCase aliases for several filters (`--appVersion`), which
    // predate the kebab-case names. Registering them keeps old scripts working.
    for (const alias of flag.aliases ?? []) {
      command.addOption(new Option(`--${alias} <value>`).hideHelp());
    }
    return;
  }

  const option = new Option(flags, flag.description);
  if (flag.default !== undefined) option.default(flag.default);
  command.addOption(option);

  if (flag.allowNo) {
    // `--no-wait` has to be its own option or commander will not clear the default.
    command.addOption(new Option(`--no-${flag.name}`).hideHelp());
  }
  for (const alias of flag.aliases ?? []) {
    command.addOption(new Option(`--${alias}`).hideHelp());
  }
}

/**
 * Maps a command id onto the module that implements it. Handlers are imported
 * lazily so `eas --help` does not pay for loading the GitHub client, Joi and
 * libsodium.
 */
const HANDLERS = {
  build: () => import('../commands/build.js').then((m) => m.build),
  'build:list': () => import('../commands/build.js').then((m) => m.buildList),
  'build:view': () => import('../commands/build.js').then((m) => m.buildView),
  'build:cancel': () => import('../commands/build.js').then((m) => m.buildCancel),
  'build:download': () => import('../commands/build.js').then((m) => m.buildDownload),
  'build:configure': () => import('../commands/build.js').then((m) => m.buildConfigure),
  'build:version:get': () => import('../commands/build.js').then((m) => m.buildVersionGet),
  'build:version:set': () => import('../commands/build.js').then((m) => m.buildVersionSet),
  submit: () => import('../commands/submit.js').then((m) => m.submit),
  'submit:list': () => import('../commands/submit.js').then((m) => m.submitList),
  'submit:view': () => import('../commands/submit.js').then((m) => m.submitView),
  'submit:status': () => import('../commands/submit.js').then((m) => m.submitStatus),
  'submit:cancel': () => import('../commands/submit.js').then((m) => m.submitCancel),
  credentials: () => import('../commands/misc.js').then((m) => m.credentials),
  config: () => import('../commands/misc.js').then((m) => m.config),
  'project:info': () => import('../commands/misc.js').then((m) => m.projectInfo),
  'device:list': () => import('../commands/misc.js').then((m) => m.deviceList),
  'device:create': () => import('../commands/misc.js').then((m) => m.deviceCreate),
  'account:view': () => import('../commands/misc.js').then((m) => m.accountView),
  'account:login': () => import('../commands/misc.js').then((m) => m.accountLogin),
  'account:logout': () => import('../commands/misc.js').then((m) => m.accountLogout),
};

export function createProgram({ version = '0.1.0' } = {}) {
  const program = new Command();

  program
    .name('rnd')
    .description(
      'Build and submit React Native apps — the EAS command surface, running on ' +
        'GitHub Actions runners and the App Store Connect CLI.'
    )
    .version(version)
    .allowExcessArguments(false)
    .showHelpAfterError();

  for (const spec of COMMANDS) {
    const names = [spec.id, ...(spec.aliases ?? [])];
    for (const name of names) {
      const command = program.command(name, { hidden: name !== spec.id });
      command.description(spec.description);

      for (const arg of spec.args ?? []) {
        // EAS treats these as optional and prompts when omitted, so they cannot
        // be declared required here.
        command.argument(`[${arg}]`, arg);
      }
      for (const flag of spec.flags) {
        applyFlag(command, flag);
      }

      command.action(async (...args) => {
        const options = args[args.length - 2];
        const positional = args.slice(0, -2);
        const load = HANDLERS[spec.id];
        if (!load) {
          throw new Error(`"${spec.id}" is declared but has no handler wired up.`);
        }
        const handler = await load();
        await handler({ args: positional, options, commandId: spec.id });
      });
    }
  }

  // Anything EAS has that we deliberately do not implement gets a straight
  // answer. Landing on commander's "unknown command" would imply a typo.
  for (const [name, reason] of Object.entries(UNSUPPORTED)) {
    program
      .command(name, { hidden: true })
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(() => {
        process.exitCode = 1;
        console.error(
          `"rnd ${name}" is not part of this replacement: ${reason}.\n` +
            'Run "rnd --help" for the commands that are supported.'
        );
      });
  }

  return program;
}
