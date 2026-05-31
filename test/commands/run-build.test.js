import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeGithubOutputs } from '../../src/commands/run-build.js';

describe('writeGithubOutputs', () => {
  it('appends key=value lines to $GITHUB_OUTPUT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gho-'));
    const file = join(dir, 'out');
    const prev = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = file;
    try {
      writeGithubOutputs({ 'build-id': 'abc', 'artifact-url': 'https://x/y.tgz' });
      const text = readFileSync(file, 'utf-8');
      assert.ok(text.includes('build-id=abc'));
      assert.ok(text.includes('artifact-url=https://x/y.tgz'));
    } finally {
      if (prev === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips null/undefined values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gho-'));
    const file = join(dir, 'out');
    const prev = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = file;
    try {
      writeGithubOutputs({ 'build-id': 'abc', 'manifest-url': null });
      const text = readFileSync(file, 'utf-8');
      assert.ok(text.includes('build-id=abc'));
      assert.ok(!text.includes('manifest-url'));
    } finally {
      if (prev === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when GITHUB_OUTPUT is unset', () => {
    const prev = process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_OUTPUT;
    try {
      assert.doesNotThrow(() => writeGithubOutputs({ 'build-id': 'abc' }));
    } finally {
      if (prev !== undefined) process.env.GITHUB_OUTPUT = prev;
    }
  });
});
