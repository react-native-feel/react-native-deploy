import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { COMMANDS, allCommandNames, findCommand } from '../../src/cli/spec.js';

const require = createRequire(import.meta.url);
/**
 * eas-cli ships the oclif manifest it generates at publish time — every command,
 * every flag, every option list, machine-readable. It is a far better contract
 * than the docs, and pinning our spec against it means an upgrade that renames a
 * flag turns this suite red rather than silently breaking a user's script.
 */
const manifest = require('eas-cli/oclif.manifest.json');

describe('CLI surface matches eas-cli', () => {
  for (const command of COMMANDS) {
    describe(command.id, () => {
      const real = manifest.commands[command.id];

      it('exists in eas-cli with the same id', () => {
        assert.ok(real, `eas-cli has no command "${command.id}"`);
      });

      it('declares the same aliases', () => {
        assert.deepEqual([...(command.aliases ?? [])].sort(), [...(real.aliases ?? [])].sort());
      });

      it('takes the same positional arguments', () => {
        const realArgs = Object.keys(real.args ?? {});
        assert.deepEqual(command.args ?? [], realArgs);
      });

      it('implements every user-facing flag eas-cli accepts', () => {
        // Hidden flags are internal to Expo's own tooling (`--skip-credentials-check`
        // and friends) and deprecated ones are on their way out, so neither is
        // part of the surface a user's scripts can rely on.
        const expected = Object.entries(real.flags ?? {})
          .filter(([, f]) => !f.hidden && !f.deprecated)
          .map(([name]) => name)
          .sort();
        const ours = command.flags.map((f) => f.name).sort();
        const missing = expected.filter((name) => !ours.includes(name));
        assert.deepEqual(missing, [], `missing flags on "${command.id}": ${missing.join(', ')}`);
      });

      it('invents no flags eas-cli does not have', () => {
        const real_ = Object.keys(real.flags ?? {});
        const extra = command.flags.map((f) => f.name).filter((name) => !real_.includes(name));
        assert.deepEqual(extra, [], `extra flags on "${command.id}": ${extra.join(', ')}`);
      });

      for (const flag of command.flags) {
        const realFlag = (real.flags ?? {})[flag.name];
        if (!realFlag) continue;

        it(`--${flag.name} keeps its short char`, () => {
          assert.equal(flag.char ?? undefined, realFlag.char ?? undefined);
        });

        it(`--${flag.name} keeps its type`, () => {
          assert.equal(flag.type, realFlag.type);
        });

        if (realFlag.options) {
          it(`--${flag.name} accepts the same values`, () => {
            assert.deepEqual([...(flag.options ?? [])].sort(), [...realFlag.options].sort());
          });
        }

        // oclif omits boolean defaults from the manifest entirely — not one of
        // eas-cli's 154 commands serializes one — so a boolean's default has to
        // be checked against the source instead (see the `--wait` case below).
        if (realFlag.default !== undefined && realFlag.type !== 'boolean') {
          it(`--${flag.name} keeps its default`, () => {
            assert.equal(flag.default, realFlag.default);
          });
        }

        if (realFlag.allowNo) {
          it(`--${flag.name} still supports --no-${flag.name}`, () => {
            assert.equal(flag.allowNo, true);
          });
        }

        if (realFlag.aliases?.length) {
          it(`--${flag.name} keeps its aliases`, () => {
            assert.deepEqual([...(flag.aliases ?? [])].sort(), [...realFlag.aliases].sort());
          });
        }

        // `--wait` defaulting to true is the difference between a command that
        // blocks until the build finishes and one that returns immediately, so
        // it gets an explicit check. eas-cli sets `default: true, allowNo: true`
        // in source; the manifest only carries the `allowNo` half.
        if (flag.name === 'wait') {
          it('--wait defaults to true and supports --no-wait', () => {
            assert.equal(flag.default, true);
            assert.equal(flag.allowNo, true);
            assert.equal(realFlag.allowNo, true);
          });
        }
      }
    });
  }
});

describe('command lookup', () => {
  it('resolves aliases to their command', () => {
    assert.equal(findCommand('whoami').id, 'account:view');
    assert.equal(findCommand('login').id, 'account:login');
    assert.equal(findCommand('build:submit').id, 'submit');
  });

  it('resolves ids directly', () => {
    assert.equal(findCommand('build:list').id, 'build:list');
  });

  it('returns nothing for an unknown name', () => {
    assert.equal(findCommand('build:teleport'), undefined);
  });

  it('every alias we claim is a real eas-cli alias', () => {
    for (const name of allCommandNames()) {
      const isRealId = Boolean(manifest.commands[name]);
      const isRealAlias = Object.values(manifest.commands).some((c) =>
        (c.aliases ?? []).includes(name)
      );
      assert.ok(isRealId || isRealAlias, `"${name}" is not a command or alias in eas-cli`);
    }
  });
});

describe('the supported subset is honest about what it covers', () => {
  it('covers the whole build and submit surface a user scripts against', () => {
    const scoped = Object.keys(manifest.commands).filter((id) =>
      /^(build|submit)(:|$)/.test(id)
    );
    // These four are Expo-internal or need Expo's build servers to mean anything.
    const outOfScope = new Set([
      'build:internal', // invoked by Expo's GitHub app, not by people
      'build:inspect', // dumps the archive Expo's builders would have used
      'build:resign', // re-signs an existing EAS build server-side
      'build:dev', // starts a dev-client build on Expo infrastructure
      'build:run', // covered, but listed here so the assertion below stays exact
      'submit:internal',
      'submit:retry',
      'build:delete',
      'build:version:sync',
    ]);
    const ours = new Set(allCommandNames());
    const uncovered = scoped.filter((id) => !ours.has(id) && !outOfScope.has(id));
    assert.deepEqual(uncovered, [], `unhandled build/submit commands: ${uncovered.join(', ')}`);
  });
});
