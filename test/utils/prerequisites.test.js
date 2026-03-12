import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkCommandExists } from '../../src/utils/prerequisites.js';

describe('prerequisites', () => {
  it('checkCommandExists returns true for "node"', () => {
    assert.strictEqual(checkCommandExists('node'), true);
  });

  it('checkCommandExists returns false for nonexistent command', () => {
    assert.strictEqual(checkCommandExists('thiscommanddoesnotexist12345'), false);
  });
});
