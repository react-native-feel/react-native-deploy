import { describe, it } from 'node:test';
import assert from 'node:assert';
import { relativeAge, printBuildsTable } from '../../src/commands/builds.js';

describe('relativeAge', () => {
  const now = Date.parse('2026-05-30T12:00:00Z');

  it('formats seconds/minutes/hours/days', () => {
    assert.strictEqual(relativeAge('2026-05-30T11:59:30Z', now), '30s ago');
    assert.strictEqual(relativeAge('2026-05-30T11:30:00Z', now), '30m ago');
    assert.strictEqual(relativeAge('2026-05-30T09:00:00Z', now), '3h ago');
    assert.strictEqual(relativeAge('2026-05-27T12:00:00Z', now), '3d ago');
  });

  it('handles missing/invalid dates', () => {
    assert.strictEqual(relativeAge(null, now), '—');
    assert.strictEqual(relativeAge('garbage', now), '—');
  });
});

describe('printBuildsTable', () => {
  it('prints a header and one row per build', () => {
    const out = [];
    const orig = process.stdout.write;
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      printBuildsTable([
        { id: 'abcdef1234', version: '1.0.0', buildNumber: '3', profile: 'preview', distribution: 'simulator', commit: 'a1b2c3d', createdAt: '2026-05-30T11:00:00Z' },
      ], { now: Date.parse('2026-05-30T12:00:00Z') });
    } finally {
      process.stdout.write = orig;
    }
    const text = out.join('');
    assert.ok(text.includes('VERSION'));
    assert.ok(text.includes('1.0.0'));
    assert.ok(text.includes('simulator'));
    assert.ok(text.includes('abcdef12')); // truncated id
  });
});
