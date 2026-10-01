import { buildFromWorkflowRun, buildIdFromRun, describeBuild, toBuildStatus } from '@eas/models/build.js';
import { describe, expect, it } from 'vitest';

import { demoBuilds } from './demo.js';

/**
 * The dashboard renders whatever the mapper produces, so these tests pin the
 * mapper's output rather than the markup. A regression here is one that would
 * show a build as finished when it failed, or lose its duration — both of which
 * matter more than any pixel.
 */

describe('GitHub run status maps onto EAS build status', () => {
  const cases = [
    [{ status: 'completed', conclusion: 'success' }, 'FINISHED'],
    [{ status: 'completed', conclusion: 'failure' }, 'ERRORED'],
    [{ status: 'completed', conclusion: 'timed_out' }, 'ERRORED'],
    [{ status: 'completed', conclusion: 'action_required' }, 'ERRORED'],
    [{ status: 'completed', conclusion: 'cancelled' }, 'CANCELED'],
    [{ status: 'completed', conclusion: 'skipped' }, 'CANCELED'],
    [{ status: 'completed', conclusion: 'stale' }, 'CANCELED'],
    [{ status: 'in_progress', conclusion: null }, 'IN_PROGRESS'],
    [{ status: 'queued', conclusion: null }, 'IN_QUEUE'],
    [{ status: 'waiting', conclusion: null }, 'IN_QUEUE'],
    [{ status: 'requested', conclusion: null }, 'NEW'],
  ];

  for (const [run, expected] of cases) {
    it(`${run.status}/${run.conclusion} → ${expected}`, () => {
      expect(toBuildStatus(run)).toBe(expected);
    });
  }

  it('treats an unrecognised conclusion as an error rather than a success', () => {
    // GitHub can add conclusions; defaulting to FINISHED would quietly report a
    // broken build as shippable.
    expect(toBuildStatus({ status: 'completed', conclusion: 'something_new' })).toBe('ERRORED');
  });
});

describe('build ids', () => {
  it('are stable for the same repo and run', () => {
    const a = buildIdFromRun({ repo: 'bidah/story-smash', runId: 18400001 });
    const b = buildIdFromRun({ repo: 'bidah/story-smash', runId: 18400001 });
    expect(a).toBe(b);
  });

  it('differ across repos with the same run id', () => {
    expect(buildIdFromRun({ repo: 'a/b', runId: 1 })).not.toBe(
      buildIdFromRun({ repo: 'c/d', runId: 1 })
    );
  });

  it('are well-formed v4-shaped UUIDs, so the router accepts them', () => {
    const id = buildIdFromRun({ repo: 'bidah/story-smash', runId: 18400001 });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('build titles read the way expo.dev writes them', () => {
  const build = (overrides) => ({ platform: 'IOS', distribution: 'STORE', isForIosSimulator: false, ...overrides });

  it('names an internal iOS build', () => {
    expect(describeBuild(build({ distribution: 'INTERNAL' }))).toBe('iOS internal distribution build');
  });

  it('names a production iOS build', () => {
    expect(describeBuild(build({}))).toBe('iOS production build');
  });

  it('names a simulator build', () => {
    expect(describeBuild(build({ distribution: 'INTERNAL', isForIosSimulator: true }))).toBe(
      'iOS simulator build'
    );
  });

  it('names an Android build', () => {
    expect(describeBuild(build({ platform: 'ANDROID', distribution: 'INTERNAL' }))).toBe(
      'Android internal distribution build'
    );
  });
});

describe('demo data flows through the real mapper', () => {
  const builds = demoBuilds();

  it('produces builds at all', () => {
    expect(builds.length).toBeGreaterThan(0);
  });

  it('carries the fields every view reads', () => {
    for (const build of builds) {
      expect(build.id).toBeTruthy();
      expect(build.status).toBeTruthy();
      expect(['IOS', 'ANDROID']).toContain(build.platform);
      expect(build.metrics).toHaveProperty('buildDuration');
      expect(build.buildProfile).toBeTruthy();
      expect(build.gitCommitHash).toBeTruthy();
    }
  });

  it('includes a failed build with a diagnosable error', () => {
    const failed = builds.find((b) => b.status === 'ERRORED');
    expect(failed).toBeTruthy();
    expect(failed.error).toBeTruthy();
    expect(failed.error.errorCode).not.toBe('UNKNOWN_ERROR');
    expect(failed.error.docsUrl).toContain('/job/');
  });

  it('gives finished builds an installable artifact and failed builds none', () => {
    for (const build of builds) {
      if (build.status === 'FINISHED') {
        expect(build.artifacts.applicationArchiveUrl).toBeTruthy();
      } else {
        expect(build.artifacts.applicationArchiveUrl).toBeNull();
      }
    }
  });

  it('builds a phase timeline whose durations sum to roughly the build time', () => {
    const build = builds.find((b) => b.status === 'FINISHED');
    const summed = build._phases.reduce((total, p) => total + (p.durationSeconds ?? 0), 0);
    // Per-step rounding drifts a little; anything beyond a few percent means the
    // phase list is telling a different story from the header.
    expect(Math.abs(summed - build.metrics.buildDuration)).toBeLessThan(
      build.metrics.buildDuration * 0.08
    );
  });

  it('marks steps after a failure as not-run rather than successful', () => {
    const failed = builds.find((b) => b.status === 'ERRORED');
    const statuses = failed._phases.map((p) => p.status);
    expect(statuses).toContain('ERRORED');
    expect(statuses).toContain('CANCELED');
    // Nothing succeeds after the failing step.
    const failedAt = statuses.indexOf('ERRORED');
    expect(statuses.slice(failedAt + 1).every((s) => s !== 'FINISHED')).toBe(true);
  });

  it('separates development builds from production ones', () => {
    const development = builds.filter(
      (b) => b.distribution === 'INTERNAL' || b.distribution === 'SIMULATOR'
    );
    expect(development.length).toBeGreaterThan(0);
    expect(development.every((b) => b.distribution !== 'STORE')).toBe(true);
  });

  it('reports an artifact expiry inside GitHub\'s 90-day retention', () => {
    for (const build of builds) {
      const days = (new Date(build.expirationDate) - new Date(build.createdAt)) / 86_400_000;
      expect(Math.round(days)).toBe(90);
    }
  });
});

describe('queue and build time are distinguished', () => {
  it('counts the gap before a runner picks up as queue time', () => {
    const created = '2026-09-05T12:00:00Z';
    const started = '2026-09-05T12:00:07Z';
    const updated = '2026-09-05T12:06:52Z';
    const build = buildFromWorkflowRun({
      run: { id: 1, created_at: created, run_started_at: started, updated_at: updated, status: 'completed', conclusion: 'success' },
      inputs: { platform: 'ios' },
    });
    expect(build.metrics.buildQueueTime).toBe(7);
    expect(build.metrics.buildDuration).toBe(405);
  });

  it('leaves duration null while a build is still running', () => {
    const build = buildFromWorkflowRun({
      run: { id: 2, created_at: '2026-09-05T12:00:00Z', run_started_at: '2026-09-05T12:00:05Z', updated_at: '2026-09-05T12:03:00Z', status: 'in_progress', conclusion: null },
      inputs: { platform: 'ios' },
    });
    expect(build.status).toBe('IN_PROGRESS');
    expect(build.metrics.buildDuration).toBeNull();
    expect(build.completedAt).toBeNull();
  });
});
