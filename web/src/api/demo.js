import { buildFromWorkflowRun } from '@eas/models/build.js';

/**
 * A demo dataset, so the dashboard renders with no GitHub token attached.
 *
 * Crucially these are raw *workflow run* shapes, not pre-baked Build records —
 * they go through the same `buildFromWorkflowRun` mapper the CLI uses. That
 * means the demo exercises the real projection rather than illustrating it, and
 * a bug in the mapper shows up here too.
 */

const DAY = 86_400_000;

function runAt({ id, daysAgo, durationSeconds, queueSeconds = 7, conclusion = 'success', sha, message, profile = 'development', platform = 'ios', distribution = 'internal', channel = 'development', version = '1.0.0', buildVersion = '1', runtime = '5a4a58f' }) {
  const created = new Date(Date.now() - daysAgo * DAY);
  const started = new Date(created.getTime() + queueSeconds * 1000);
  const updated = new Date(started.getTime() + durationSeconds * 1000);
  const inputs = {
    platform,
    profile,
    distribution,
    channel,
    app_version: version,
    app_build_version: buildVersion,
    runtime_version: runtime,
    fingerprint_hash: runtime,
    message,
  };
  return {
    run: {
      id,
      name: `${platform} ${profile} build [eas:${Object.entries(inputs).map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`).join(';')}]`,
      run_number: id % 1000,
      run_attempt: 1,
      status: 'completed',
      conclusion,
      html_url: `https://github.com/bidah/story-smash/actions/runs/${id}`,
      head_sha: sha,
      head_commit: { message },
      actor: { id: 4242, login: 'bidah' },
      created_at: created.toISOString(),
      run_started_at: started.toISOString(),
      updated_at: updated.toISOString(),
    },
    inputs,
    jobs: [demoJob({ conclusion, started, durationSeconds, platform })],
    artifacts:
      conclusion === 'success'
        ? [
            {
              id: id + 1,
              name: 'application-archive',
              archive_download_url: `https://api.github.com/repos/bidah/story-smash/actions/artifacts/${id + 1}/zip`,
              size_in_bytes: 44_500_000,
            },
            {
              id: id + 2,
              name: 'xcode-logs',
              archive_download_url: `https://api.github.com/repos/bidah/story-smash/actions/artifacts/${id + 2}/zip`,
              size_in_bytes: 2_100_000,
            },
          ]
        : [],
  };
}

/**
 * Step timings that add up to the job duration, so the phase list in the UI
 * looks like a real build rather than evenly spaced filler.
 */
const IOS_STEPS = [
  ['Spin up build environment', 1],
  ['Prepare project', 1],
  ['Read eas.json', 1],
  ['Read package.json', 1],
  ['Install dependencies', 15],
  ['Read app config', 1],
  ['Run expo doctor', 2],
  ['Prepare credentials', 3],
  ['Prebuild', 1],
  ['Install pods', 32],
  ['Calculate expo-updates runtime version', 2],
  ['Configure Xcode project', 1],
  ['Configure expo-updates', 1],
  ['Run fastlane', 329],
  ['Clean up credentials', 1],
  ['Analyze build performance', 2],
  ['Upload application archive', 1],
];

const ANDROID_STEPS = [
  ['Spin up build environment', 1],
  ['Prepare project', 1],
  ['Read eas.json', 1],
  ['Install dependencies', 22],
  ['Read app config', 1],
  ['Prepare credentials', 2],
  ['Prebuild', 3],
  ['Run gradle', 210],
  ['Upload application archive', 2],
];

function demoJob({ conclusion, started, durationSeconds, platform }) {
  const template = platform === 'ios' ? IOS_STEPS : ANDROID_STEPS;
  const total = template.reduce((sum, [, s]) => sum + s, 0);
  const scale = durationSeconds / total;

  let cursor = started.getTime();
  const steps = template.map(([name, seconds], index) => {
    const stepStart = new Date(cursor);
    const stepDuration = Math.max(1, Math.round(seconds * scale));
    cursor += stepDuration * 1000;
    // On a failed run, everything after the failing step never ran.
    const failedAt = template.length - 4;
    const stepConclusion =
      conclusion === 'failure'
        ? index < failedAt
          ? 'success'
          : index === failedAt
            ? 'failure'
            : 'skipped'
        : 'success';
    return {
      name,
      number: index + 1,
      status: 'completed',
      conclusion: stepConclusion,
      started_at: stepStart.toISOString(),
      completed_at: new Date(cursor).toISOString(),
    };
  });

  return { id: 99_000 + steps.length, name: platform, steps };
}

const COMMIT_MESSAGE =
  'A tap gets the wave, a hold gets the dome. The CTA was borrowing the ' +
  "press-and-hold's whole treatment: a bubble growing out of the bar, a ripple, " +
  'frost held over the frozen feed until the storyteller answered.';

const RUNS = [
  runAt({ id: 18_400_001, daysAgo: 11, durationSeconds: 405, sha: '9bf295c1f4a2b8e7d3c5a9f1e6b2d4c8a7f3e1b9', message: COMMIT_MESSAGE }),
  runAt({ id: 18_300_002, daysAgo: 20, durationSeconds: 414, sha: '555f38c9e2a1b7d4c6f8a3e5b1d9c7f2a4e6b8d1', message: 'Freeze the feed while the extend screen loads', runtime: '1ca2b27' }),
  runAt({ id: 18_200_003, daysAgo: 21, durationSeconds: 415, sha: 'e52d574a8c3f1b9e7d2a6c4f8b1e3d5a9c7f2b4e', message: 'Swap the mic dome for a press-and-hold bubble', runtime: 'c92aa16' }),
  runAt({
    id: 18_100_004,
    daysAgo: 24,
    durationSeconds: 208,
    conclusion: 'failure',
    sha: 'a17c903b5e2d8f1a4c6b9e3d7f2a5c8b1e4d6f9a',
    message: 'Bump expo-av and regenerate pods',
    runtime: 'c92aa16',
  }),
  runAt({
    id: 18_000_005,
    daysAgo: 26,
    durationSeconds: 268,
    platform: 'android',
    profile: 'preview',
    distribution: 'internal',
    channel: 'preview',
    sha: 'b48e21d7f3a9c5e1b6d8f2a4c7e9b3d5f1a6c8e2',
    message: 'Preview build for the storyteller flow',
    runtime: 'c92aa16',
  }),
];

/** Production builds and submissions are empty here, matching the demo project. */
export function demoBuilds() {
  return RUNS.map(({ run, jobs, artifacts, inputs }) =>
    buildFromWorkflowRun({
      run,
      jobs,
      artifacts,
      inputs,
      app: {
        repo: 'bidah/story-smash',
        name: 'story-smash',
        slug: 'story-smash',
        appIdentifier: 'com.bidah.storysmash',
        sdkVersion: '52.0.0',
      },
      account: { name: 'bidah' },
    })
  );
}

export function demoSubmissions() {
  return [];
}

export const DEMO_PROJECT = {
  name: 'story-smash',
  slug: 'story-smash',
  account: 'bidah',
  repo: 'bidah/story-smash',
};
