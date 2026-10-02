import { randomUUID } from 'node:crypto';

import { buildFromWorkflowRun } from '../models/build.js';
import { packForDispatch } from './plan.js';

export const WORKFLOW_FILE = 'eas-build.yml';

/**
 * Reads builds out of GitHub Actions and presents them as EAS Build records.
 *
 * The one awkward seam is dispatch: `workflow_dispatch` returns 204 with no
 * body, so GitHub never tells you which run your call created. The workflow
 * therefore stamps a caller-supplied id into its `run-name`, and we poll the run
 * list for it. Matching on "most recent run" instead would pick up a colleague's
 * build pushed in the same second.
 */
export class BuildService {
  constructor({ client, app = {}, account = {} }) {
    this.client = client;
    this.app = { ...app, repo: client.repo };
    this.account = account;
  }

  /** Pulls the dispatch inputs back out of the run name the workflow stamped. */
  static parseRunName(runName = '') {
    const match = runName.match(/\[eas:([^\]]+)\]/);
    if (!match) {
      return {};
    }
    const inputs = {};
    for (const pair of match[1].split(';')) {
      const index = pair.indexOf('=');
      if (index > 0) {
        inputs[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
      }
    }
    return inputs;
  }

  static encodeRunName(inputs) {
    return Object.entries(inputs)
      .map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
      .join(';');
  }

  async listBuilds({ limit = 10, offset = 0, filters = {} } = {}) {
    // Over-fetch, because filtering happens client-side: GitHub cannot filter on
    // our dispatch inputs, only on its own run fields.
    const perPage = Math.min(100, (limit + offset) * 3 || 30);
    const { workflow_runs: runs = [] } = await this.client.listRuns({
      workflow: WORKFLOW_FILE,
      perPage,
    });

    const builds = runs.map((run) =>
      buildFromWorkflowRun({
        run,
        inputs: { ...BuildService.parseRunName(run.name ?? run.display_title ?? ''), ...runInputs(run) },
        app: this.app,
        account: this.account,
      })
    );

    return applyFilters(builds, filters).slice(offset, offset + limit);
  }

  /**
   * Resolves a build by EAS-style UUID, by raw run id, or by a unique id prefix —
   * the same leniency EAS has, where people paste the short id from a URL.
   */
  async findBuild(idOrRunId) {
    if (/^\d+$/.test(idOrRunId)) {
      return this.getBuildByRunId(Number(idOrRunId));
    }
    const builds = await this.listBuilds({ limit: 100 });
    const exact = builds.find((b) => b.id === idOrRunId);
    if (exact) {
      return this.getBuildByRunId(exact._githubRunId);
    }
    const prefixed = builds.filter((b) => b.id.startsWith(idOrRunId));
    if (prefixed.length === 1) {
      return this.getBuildByRunId(prefixed[0]._githubRunId);
    }
    if (prefixed.length > 1) {
      throw new Error(`Build id "${idOrRunId}" is ambiguous — it matches ${prefixed.length} builds.`);
    }
    return null;
  }

  /** The detailed view: run plus jobs plus artifacts, which needs three calls. */
  async getBuildByRunId(runId) {
    const run = await this.client.getRun(runId);
    const [{ jobs = [] }, { artifacts = [] }] = await Promise.all([
      this.client.listJobs(runId),
      this.client.listArtifacts(runId),
    ]);
    return buildFromWorkflowRun({
      run,
      jobs,
      artifacts,
      inputs: { ...BuildService.parseRunName(run.name ?? ''), ...runInputs(run) },
      app: this.app,
      account: this.account,
    });
  }

  /**
   * Dispatches a build and waits for the run to appear.
   *
   * The poll is bounded: if the run never shows up, the likeliest cause is that
   * the workflow on that ref is older than the CLI and no longer stamps the
   * dispatch id, which is worth saying out loud rather than hanging.
   */
  async dispatchBuild({ ref, inputs, timeoutMs = 60_000, pollMs = 2_000, now = Date.now }) {
    const dispatchId = randomUUID();
    await this.client.dispatchWorkflow({
      workflow: WORKFLOW_FILE,
      ref,
      // GitHub allows at most ten dispatch inputs, so the plan is packed into a
      // JSON blob plus the few fields the workflow needs before it can parse.
      inputs: packForDispatch(inputs, { dispatchId }),
    });

    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const { workflow_runs: runs = [] } = await this.client.listRuns({
        workflow: WORKFLOW_FILE,
        perPage: 20,
      });
      const match = runs.find((run) => (run.name ?? '').includes(dispatchId));
      if (match) {
        return this.getBuildByRunId(match.id);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(
      `The build was dispatched but no matching run appeared within ${Math.round(timeoutMs / 1000)}s.\n` +
        `This usually means .github/workflows/${WORKFLOW_FILE} on "${ref}" is out of date and no ` +
        'longer stamps the dispatch id into its run-name. Run "rnd build:configure" and push the workflow.'
    );
  }

  async cancelBuild(build) {
    await this.client.cancelRun(build._githubRunId);
  }
}

/**
 * GitHub does not return dispatch inputs on the run object, so the workflow
 * mirrors the ones the UI needs into `display_title`. Anything missing simply
 * stays undefined and the Build record carries a null.
 */
function runInputs(run) {
  const inputs = BuildService.parseRunName(run.display_title ?? '');
  return { ...inputs, message: inputs.message ?? run.head_commit?.message ?? null };
}

function applyFilters(builds, filters) {
  return builds.filter((build) => {
    if (filters.platform && filters.platform !== 'all') {
      if (build.platform !== filters.platform.toUpperCase()) return false;
    }
    if (filters.status && build.status !== filters.status.toUpperCase().replace(/-/g, '_')) {
      return false;
    }
    if (filters.distribution && build.distribution !== filters.distribution.toUpperCase()) {
      return false;
    }
    if (filters.buildProfile && build.buildProfile !== filters.buildProfile) return false;
    if (filters.channel && build.updateChannel?.name !== filters.channel) return false;
    if (filters.appVersion && build.appVersion !== filters.appVersion) return false;
    if (filters.gitCommitHash && !build.gitCommitHash?.startsWith(filters.gitCommitHash)) {
      return false;
    }
    if (filters.simulator && !build.isForIosSimulator) return false;
    return true;
  });
}
