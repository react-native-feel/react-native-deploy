#!/usr/bin/env node
import { createCli } from '../src/cli.js';
import { logger } from '../src/utils/logger.js';

const program = createCli();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  logger.error(err.message);
  if (process.env.RN_BUILD_DEBUG) console.error(err);
  process.exit(1);
}
