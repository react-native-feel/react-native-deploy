import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Logger } from '../../src/utils/logger.js';

describe('Logger', () => {
  let logs;
  let originalWrite;

  beforeEach(() => {
    logs = [];
    originalWrite = process.stdout.write;
    process.stdout.write = (msg) => { logs.push(msg); return true; };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('info outputs message', () => {
    const logger = new Logger();
    logger.info('hello');
    assert.ok(logs.some(l => l.includes('hello')));
  });

  it('error outputs to stderr', () => {
    const errLogs = [];
    const origErr = process.stderr.write;
    process.stderr.write = (msg) => { errLogs.push(msg); return true; };
    const logger = new Logger();
    logger.error('bad thing');
    process.stderr.write = origErr;
    assert.ok(errLogs.some(l => l.includes('bad thing')));
  });

  it('step outputs numbered step', () => {
    const logger = new Logger();
    logger.step(1, 5, 'Doing thing');
    assert.ok(logs.some(l => l.includes('[1/5]') && l.includes('Doing thing')));
  });
});
