import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkCommandExists, verifyPrerequisites } from '../../src/utils/prerequisites.js';

describe('prerequisites', () => {
  it('checkCommandExists returns true for "node"', () => {
    assert.strictEqual(checkCommandExists('node'), true);
  });

  it('checkCommandExists returns false for nonexistent command', () => {
    assert.strictEqual(checkCommandExists('thiscommanddoesnotexist12345'), false);
  });

  // macincloud + simulator must NOT require local aws/asc. git + ssh exist on
  // any dev machine running the suite, so this resolves without throwing.
  it('macincloud + simulator does not require aws or asc locally', async () => {
    await assert.doesNotReject(
      verifyPrerequisites({ hostKind: 'macincloud', distribution: 'simulator' })
    );
  });
});
