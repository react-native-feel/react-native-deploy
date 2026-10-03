import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProgram } from '../../src/cli/program.js';
import { findCommand } from '../../src/cli/spec.js';
import { summarizeFlags, telemetryEnabled } from '../../src/utils/telemetry.js';

/** Parses argv against the real program without running any handler. */
function parsed(argv) {
  const program = createProgram();
  const command = program.commands.find((c) => c.name() === argv[0]);
  command.action(() => {});
  program.parse(argv, { from: 'user' });
  return command;
}

describe('telemetry', () => {
  it('is off when running from source, with no key inlined', () => {
    assert.equal(telemetryEnabled({}), false);
  });

  it('reports only the flags a user typed, and never free-text values', () => {
    const command = parsed(['build', '-p', 'ios', '--profile', 'my-secret-profile', '--no-wait', '-m', 'hello']);
    assert.deepEqual(summarizeFlags(findCommand('build'), command), {
      platform: 'ios',
      profile: true,
      wait: false,
      message: true,
    });
  });

  it('counts a camelCase alias under the flag it stands for', () => {
    const command = parsed(['build:list', '--appVersion', '1.2.3']);
    assert.deepEqual(summarizeFlags(findCommand('build:list'), command), { 'app-version': true });
  });
});
