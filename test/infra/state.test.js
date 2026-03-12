import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, saveState, clearState, isWithinMinAllocation } from '../../src/infra/state.js';

const TMP = join(import.meta.dirname, '../../.tmp-test-state');

describe('state management', () => {
  beforeEach(() => mkdirSync(TMP, { recursive: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('returns null when no state file exists', () => {
    const state = loadState(TMP);
    assert.strictEqual(state, null);
  });

  it('saves and loads state', () => {
    const data = { hostId: 'h-123', instanceId: 'i-456', publicIp: '1.2.3.4', allocatedAt: new Date().toISOString(), region: 'us-east-1', amiId: 'ami-base123' };
    saveState(data, TMP);
    const loaded = loadState(TMP);
    assert.strictEqual(loaded.hostId, 'h-123');
    assert.strictEqual(loaded.instanceId, 'i-456');
    assert.strictEqual(loaded.amiId, 'ami-base123');
  });

  it('clears state', () => {
    saveState({ hostId: 'h-123' }, TMP);
    clearState(TMP);
    assert.strictEqual(loadState(TMP), null);
  });

  it('detects within 24h minimum allocation', () => {
    const recent = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isWithinMinAllocation(recent), true);
  });

  it('detects past 24h minimum allocation', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isWithinMinAllocation(old), false);
  });
});
