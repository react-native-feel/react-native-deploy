import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  workflowRunArgs,
  runListArgs,
  runViewArgs,
  triggerGithubActionsBuild,
} from '../../src/remote/github-actions.js';

const host = { repo: 'bidah/app', workflow: 'rn-deploy.yml', ref: 'main' };
const silentLog = { info() {}, success() {}, warn() {}, error() {} };

describe('gh arg builders', () => {
  it('workflowRunArgs includes repo, ref and -f inputs', () => {
    const args = workflowRunArgs(host, { profile: 'preview', message: 'hi' });
    assert.deepStrictEqual(args, [
      'workflow', 'run', 'rn-deploy.yml', '--repo', 'bidah/app', '--ref', 'main',
      '-f', 'profile=preview', '-f', 'message=hi',
    ]);
  });

  it('workflowRunArgs drops empty inputs', () => {
    const args = workflowRunArgs(host, { profile: 'preview', message: '' });
    assert.ok(!args.includes('message='));
    assert.ok(args.includes('profile=preview'));
  });

  it('runListArgs / runViewArgs request JSON', () => {
    assert.ok(runListArgs(host).includes('--json'));
    assert.deepStrictEqual(
      runViewArgs(host, 123),
      ['run', 'view', '123', '--repo', 'bidah/app', '--json', 'status,conclusion,url']
    );
  });
});

describe('triggerGithubActionsBuild', () => {
  // Build a fake gh that returns scripted JSON per subcommand.
  function makeGh({ runs, views }) {
    const calls = [];
    let viewIdx = 0;
    return {
      calls,
      gh(args) {
        calls.push(args);
        if (args[0] === 'workflow') return Promise.resolve({ stdout: '' });
        if (args[0] === 'run' && args[1] === 'list') return Promise.resolve({ stdout: JSON.stringify(runs) });
        if (args[0] === 'run' && args[1] === 'view') {
          const v = views[Math.min(viewIdx, views.length - 1)];
          viewIdx++;
          return Promise.resolve({ stdout: JSON.stringify(v) });
        }
        return Promise.resolve({ stdout: '{}' });
      },
    };
  }

  it('dispatches, finds the fresh run, and resolves on success', async () => {
    const t0 = 1_000_000;
    const { gh, calls } = makeGh({
      runs: [{ databaseId: 42, status: 'in_progress', createdAt: new Date(t0).toISOString() }],
      views: [
        { status: 'in_progress' },
        { status: 'completed', conclusion: 'success', url: 'https://gha/42' },
      ],
    });
    const result = await triggerGithubActionsBuild({
      host, profile: 'preview', gh, sleep: async () => {}, now: () => t0,
      pollIntervalMs: 1, log: silentLog,
    });
    assert.strictEqual(result.runId, 42);
    assert.strictEqual(result.conclusion, 'success');
    assert.deepStrictEqual(calls[0].slice(0, 3), ['workflow', 'run', 'rn-deploy.yml']);
  });

  it('throws when the run concludes in failure', async () => {
    const t0 = 1_000_000;
    const { gh } = makeGh({
      runs: [{ databaseId: 7, status: 'in_progress', createdAt: new Date(t0).toISOString() }],
      views: [{ status: 'completed', conclusion: 'failure', url: 'https://gha/7' }],
    });
    await assert.rejects(
      () => triggerGithubActionsBuild({ host, profile: 'preview', gh, sleep: async () => {}, now: () => t0, pollIntervalMs: 1, log: silentLog }),
      /concluded "failure"/
    );
  });

  it('times out if no run ever appears', async () => {
    let clock = 0;
    const gh = (args) => {
      if (args[0] === 'workflow') return Promise.resolve({ stdout: '' });
      return Promise.resolve({ stdout: '[]' }); // run list never returns a fresh run
    };
    await assert.rejects(
      () => triggerGithubActionsBuild({
        host, profile: 'preview', gh,
        sleep: async () => { clock += 10_000; },
        now: () => clock,
        pollIntervalMs: 10_000, timeoutMs: 30_000, log: silentLog,
      }),
      /Timed out waiting for the workflow run to appear/
    );
  });
});
