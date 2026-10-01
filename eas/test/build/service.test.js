import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BuildService } from '../../src/build/service.js';

/**
 * The service layer's own concerns: correlating a dispatch to a run, and
 * filtering. Both are pure enough to test against a fake client, which is worth
 * doing — a broken correlation means `eas build` hangs, and a broken filter
 * silently hides builds.
 */

function fakeClient({ runs = [], jobs = [], artifacts = [], onDispatch } = {}) {
  return {
    repo: 'bidah/story-smash',
    dispatchWorkflow: async (payload) => onDispatch?.(payload),
    listRuns: async () => ({ workflow_runs: runs }),
    getRun: async (id) => runs.find((r) => r.id === id),
    listJobs: async () => ({ jobs }),
    listArtifacts: async () => ({ artifacts }),
    cancelRun: async () => {},
  };
}

function run({ id, name, conclusion = 'success', daysAgo = 1 }) {
  const created = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    name,
    status: 'completed',
    conclusion,
    created_at: created,
    run_started_at: created,
    updated_at: created,
    head_sha: 'abc1234def',
    html_url: `https://github.com/bidah/story-smash/actions/runs/${id}`,
  };
}

describe('run-name correlation', () => {
  it('round-trips dispatch inputs through the run name', () => {
    const inputs = { dispatch_id: 'abc-123', platform: 'ios', profile: 'production' };
    const encoded = BuildService.encodeRunName(inputs);
    assert.deepEqual(BuildService.parseRunName(`build [eas:${encoded}]`), inputs);
  });

  it('survives values containing the delimiters', () => {
    const inputs = { message: 'fix a=b; and c=d', profile: 'production' };
    const encoded = BuildService.encodeRunName(inputs);
    assert.deepEqual(BuildService.parseRunName(`x [eas:${encoded}]`), inputs);
  });

  it('returns nothing for a run name we did not stamp', () => {
    assert.deepEqual(BuildService.parseRunName('Some other workflow'), {});
    assert.deepEqual(BuildService.parseRunName(''), {});
  });
});

describe('dispatch', () => {
  it('packs the plan into at most ten workflow inputs', async () => {
    let sent;
    const service = new BuildService({
      client: fakeClient({
        onDispatch: (payload) => {
          sent = payload;
        },
        runs: [],
      }),
    });

    await service
      .dispatchBuild({
        ref: 'main',
        inputs: { platform: 'ios', profile: 'production', runner: 'macos-15', scheme: 'App', env_json: '{}' },
        timeoutMs: 0,
      })
      .catch(() => {
        // The fake never produces a matching run; we only care about the payload.
      });

    assert.ok(sent, 'nothing was dispatched');
    assert.ok(Object.keys(sent.inputs).length <= 10);
    assert.ok(sent.inputs.dispatch_id, 'a dispatch id must be sent for correlation');
    assert.equal(sent.ref, 'main');
  });

  it('explains a stale workflow rather than hanging when no run appears', async () => {
    const service = new BuildService({ client: fakeClient({ runs: [] }) });
    await assert.rejects(
      () =>
        service.dispatchBuild({
          ref: 'main',
          inputs: { platform: 'ios', profile: 'production', runner: 'macos-15' },
          timeoutMs: 0,
        }),
      /no matching run appeared[\s\S]*out of date/
    );
  });

  it('finds the run whose name carries our dispatch id, not merely the newest', async () => {
    let dispatchId;
    const others = [run({ id: 1, name: 'someone else [eas:dispatch_id=other]' })];
    const client = fakeClient({
      runs: others,
      onDispatch: (payload) => {
        dispatchId = payload.inputs.dispatch_id;
        // The matching run only shows up after the dispatch, as on GitHub.
        others.unshift(
          run({ id: 2, name: `mine [eas:dispatch_id=${dispatchId};platform=ios;profile=production]` })
        );
      },
    });
    const service = new BuildService({ client });

    const build = await service.dispatchBuild({
      ref: 'main',
      inputs: { platform: 'ios', profile: 'production', runner: 'macos-15' },
      timeoutMs: 5_000,
      pollMs: 1,
    });
    assert.equal(build._githubRunId, 2);
    assert.equal(build.buildProfile, 'production');
  });
});

describe('listing and filters', () => {
  const runs = [
    run({ id: 10, name: 'a [eas:platform=ios;profile=production;distribution=store;channel=production]' }),
    run({ id: 11, name: 'b [eas:platform=ios;profile=development;distribution=internal;channel=development]' }),
    run({ id: 12, name: 'c [eas:platform=android;profile=development;distribution=internal;channel=development]', conclusion: 'failure' }),
  ];
  const service = () => new BuildService({ client: fakeClient({ runs }) });

  it('returns every build with no filters', async () => {
    assert.equal((await service().listBuilds({ limit: 50 })).length, 3);
  });

  it('filters by platform', async () => {
    const ios = await service().listBuilds({ limit: 50, filters: { platform: 'ios' } });
    assert.equal(ios.length, 2);
    assert.ok(ios.every((b) => b.platform === 'IOS'));
  });

  it('treats platform "all" as no filter', async () => {
    assert.equal((await service().listBuilds({ limit: 50, filters: { platform: 'all' } })).length, 3);
  });

  it('filters by distribution', async () => {
    const internal = await service().listBuilds({ limit: 50, filters: { distribution: 'internal' } });
    assert.equal(internal.length, 2);
  });

  it('filters by build profile', async () => {
    const dev = await service().listBuilds({ limit: 50, filters: { buildProfile: 'development' } });
    assert.equal(dev.length, 2);
  });

  it('accepts EAS\'s kebab-case status names', async () => {
    // `--status in-progress` is what the CLI takes; the record holds IN_PROGRESS.
    const errored = await service().listBuilds({ limit: 50, filters: { status: 'errored' } });
    assert.equal(errored.length, 1);
    assert.equal(errored[0]._githubRunId, 12);
  });

  it('honours limit and offset', async () => {
    const page = await service().listBuilds({ limit: 1, offset: 1 });
    assert.equal(page.length, 1);
    assert.equal(page[0]._githubRunId, 11);
  });
});

describe('finding a build', () => {
  const runs = [run({ id: 10, name: 'a [eas:platform=ios;profile=production]' })];
  const service = () => new BuildService({ client: fakeClient({ runs }) });

  it('resolves a raw GitHub run id', async () => {
    const build = await service().findBuild('10');
    assert.equal(build._githubRunId, 10);
  });

  it('resolves a full EAS-style id', async () => {
    const [listed] = await service().listBuilds({ limit: 1 });
    const build = await service().findBuild(listed.id);
    assert.equal(build._githubRunId, 10);
  });

  it('resolves a unique id prefix, as pasted from a URL', async () => {
    const [listed] = await service().listBuilds({ limit: 1 });
    const build = await service().findBuild(listed.id.slice(0, 8));
    assert.equal(build._githubRunId, 10);
  });

  it('returns null for an id that matches nothing', async () => {
    assert.equal(await service().findBuild('ffffffff'), null);
  });
});
