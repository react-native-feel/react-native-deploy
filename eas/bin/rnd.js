#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProgram } from '../src/cli/program.js';
import { Log } from '../src/utils/logger.js';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8')
);

const program = createProgram({ version: pkg.version });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  // Commander already prints usage errors and exits; anything reaching here is
  // ours, and a stack trace helps nobody unless they asked for it.
  Log.error(err.message);
  if (process.env.EAS_DEBUG) {
    Log.error(err.stack);
  }
  process.exit(1);
}
