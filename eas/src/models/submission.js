import { randomUUID } from 'node:crypto';

/**
 * The Submission record, shaped like EAS's GraphQL `SubmissionFragment` so that
 * `eas submit --json` and the dashboard's Submissions view read the same thing
 * a script written against EAS already expects.
 */

export const SubmissionStatus = {
  AWAITING_BUILD: 'AWAITING_BUILD',
  IN_QUEUE: 'IN_QUEUE',
  IN_PROGRESS: 'IN_PROGRESS',
  FINISHED: 'FINISHED',
  ERRORED: 'ERRORED',
  CANCELED: 'CANCELED',
};

export const AndroidReleaseStatus = {
  COMPLETED: 'COMPLETED',
  DRAFT: 'DRAFT',
  HALTED: 'HALTED',
  IN_PROGRESS: 'IN_PROGRESS',
};

export function submissionRecord({
  id = randomUUID(),
  platform,
  status,
  appId,
  groups = [],
  archivePath = null,
  app = {},
  account = {},
  error = null,
  track,
  releaseStatus,
  rollout,
  appleIdUsername = null,
} = {}) {
  const isIos = platform === 'ios' || platform === 'IOS';
  return {
    __typename: 'Submission',
    id,
    status,
    platform: isIos ? 'IOS' : 'ANDROID',
    app: {
      id: app.id ?? null,
      name: app.name ?? null,
      slug: app.slug ?? null,
      ownerAccount: { id: account.id ?? null, name: account.name ?? null },
    },
    androidConfig: isIos
      ? null
      : {
          track: track ?? null,
          releaseStatus: releaseStatus ?? null,
          rollout: rollout ?? null,
        },
    iosConfig: isIos
      ? { ascAppIdentifier: appId ?? null, appleIdUsername }
      : null,
    error,
    logFiles: [],
    // Beyond the fragment, but useful to anyone reading our JSON: which groups
    // the build actually landed in, and what was uploaded.
    _testFlightGroups: groups,
    _archivePath: archivePath,
    _submittedAt: new Date().toISOString(),
  };
}
