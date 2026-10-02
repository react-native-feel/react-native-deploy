import chalk from 'chalk';
import { existsSync } from 'node:fs';

import { BuildService } from '../build/service.js';
import { EasJsonAccessor } from '../easjson/accessor.js';
import { EasJsonUtils } from '../easjson/utils.js';
import { clientFor } from '../github/api.js';
import { SubmissionStatus, submissionRecord } from '../models/submission.js';
import {
  addToTestFlightGroups,
  appStoreStatus,
  ascEnvFromProfile,
  resolveAscAppId,
  uploadBuild,
} from '../submit/asc.js';
import { Log, die, link, printJson, setJsonMode } from '../utils/logger.js';
import { loadProjectContext } from '../utils/project.js';

function context() {
  const project = loadProjectContext();
  const accessor = EasJsonAccessor.fromProjectPath(project.projectRoot);
  return { project, accessor };
}

function platformsFor(value) {
  const requested = value ?? 'all';
  return requested === 'all' ? ['ios'] : [requested];
}

/**
 * `eas submit` — takes a built binary to the store.
 *
 * The archive can come from four places, exactly as in EAS: `--path` (local
 * file), `--id` (a previous build), `--url`, or `--latest`. Everything else —
 * which app, which key, which TestFlight groups — comes from the submit profile,
 * so the same eas.json that drove EAS drives this.
 */
export async function submit({ options }) {
  const { project, accessor } = context();
  const profileName = options.profile ?? 'production';

  for (const platform of platformsFor(options.platform)) {
    if (platform === 'android') {
      die(
        'Android submission is not wired up yet — it needs a Google Play service account, not asc. ' +
          'Use "--platform ios" for now; the .aab from "rnd build" uploads to Play Console unchanged.'
      );
    }

    let profile;
    try {
      profile = await EasJsonUtils.getSubmitProfileAsync(accessor, platform, options.profile);
    } catch (err) {
      die(err.message);
    }

    const archive = await resolveArchive({ project, options, platform });
    const env = ascEnvFromProfile(profile);
    const appId = await resolveAscAppId({
      profile,
      bundleIdentifier: project.appConfig.ios.bundleIdentifier,
      env,
    });

    // `--groups` on the command line replaces the profile's list rather than
    // adding to it — that is how EAS behaves, and it is what makes a one-off
    // "just my own group this time" submission possible.
    const groups = options.groups
      ? String(options.groups).split(',').map((g) => g.trim()).filter(Boolean)
      : (profile.groups ?? []);

    Log.log(`${chalk.bold('›')} Submitting ${chalk.cyan(archive.description)} to App Store Connect app ${chalk.cyan(appId)}`);

    await uploadBuild({
      appId,
      ipaPath: archive.path,
      whatToTest: options.whatToTest,
      language: profile.language,
      // Adding TestFlight groups needs the build to exist server-side, so a
      // submission that requests groups must wait for processing regardless of
      // --no-wait. --no-wait only skips the final "is it Ready to Test" poll.
      wait: options.wait || groups.length > 0,
      env,
      stream: options.verbose !== false,
    });
    Log.succeed('Upload complete');

    const added = await addToTestFlightGroups({ appId, groups, env });
    if (added.length) {
      Log.succeed(`Added to TestFlight groups: ${added.map((g) => g.name).join(', ')}`);
    }

    const record = submissionRecord({
      platform,
      status: SubmissionStatus.FINISHED,
      appId,
      groups: added,
      archivePath: archive.path,
      app: { name: project.appConfig.name, slug: project.appConfig.slug },
    });

    if (options.json) {
      setJsonMode(true);
      printJson(record);
    } else {
      Log.log('');
      Log.log(`  ${link(`https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`)}`);
    }
  }
}

/**
 * Finds the binary to submit. `--path` is checked on disk before anything is
 * uploaded, because a typo'd path that only surfaces after an asc round-trip is
 * a slow way to learn about it.
 */
async function resolveArchive({ project, options, platform }) {
  if (options.path) {
    if (!existsSync(options.path)) {
      die(`No file at "${options.path}".`);
    }
    return { path: options.path, description: options.path };
  }
  if (options.url) {
    die(
      'Submitting from a URL is not supported — asc uploads from a local file. ' +
        'Download the archive first, then pass --path.'
    );
  }

  const service = new BuildService({ client: clientFor(project.repo) });
  const build = options.id
    ? await service.findBuild(options.id)
    : (await service.listBuilds({ limit: 1, filters: { platform, distribution: 'store' } }))[0];

  if (!build) {
    die(
      options.id
        ? `No build found with id "${options.id}".`
        : 'No store build found to submit. Run "rnd build --profile production" first, or pass --path.'
    );
  }
  die(
    `Build ${build.id} lives on GitHub Actions as a zipped artifact, which asc cannot upload directly.\n` +
      `Download and unzip it first:\n  rnd build:download --build-id ${build.id}\n  rnd submit --path build/<name>.ipa`
  );
}

export async function submitList({ options }) {
  setJsonMode(options.json);
  Log.warn(
    'Submission history is not stored locally — App Store Connect is the record. ' +
      'Showing recent TestFlight builds instead.'
  );
  await submitStatus({ options });
}

export async function submitView({ options }) {
  setJsonMode(options.json);
  await submitStatus({ options });
}

/** `eas submit:status` — the live version and recent TestFlight builds. */
export async function submitStatus({ options }) {
  setJsonMode(options.json);
  const { project, accessor } = context();
  const profile = await EasJsonUtils.getSubmitProfileAsync(accessor, 'ios', options.profile);
  const env = ascEnvFromProfile(profile);
  const appId = await resolveAscAppId({
    profile,
    bundleIdentifier: project.appConfig.ios.bundleIdentifier,
    env,
  });

  const status = await appStoreStatus({ appId, env });
  if (options.json) {
    printJson(status);
    return;
  }

  const builds = Array.isArray(status.builds) ? status.builds : (status.builds?.data ?? []);
  Log.log('');
  Log.log(chalk.bold(`TestFlight builds for app ${appId}`));
  if (!builds.length) {
    Log.log('  (none)');
  }
  for (const build of builds.slice(0, 10)) {
    const attrs = build.attributes ?? build;
    Log.log(
      `  ${chalk.cyan(attrs.version ?? '—')}  ${chalk.dim(attrs.processingState ?? '')}  ${chalk.dim(attrs.uploadedDate ?? '')}`
    );
  }
  Log.log('');
}

export async function submitCancel() {
  die(
    'An App Store Connect upload cannot be cancelled once it has started. ' +
      'To stop a build reaching testers, remove it from its TestFlight groups: ' +
      '"asc builds remove-groups --app <id> --latest --group <group> --confirm".'
  );
}
