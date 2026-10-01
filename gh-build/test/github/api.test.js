import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo } from '../../src/github/api.js';

test('splits owner/name', () => {
  assert.deepEqual(parseRepo('acme/mobile-app'), { owner: 'acme', repo: 'mobile-app' });
});

test('rejects a bare repo name', () => {
  assert.throws(() => parseRepo('mobile-app'), /owner\/name/);
});

test('rejects an empty slug with a readable message', () => {
  assert.throws(() => parseRepo(''), /\(empty\)/);
});
