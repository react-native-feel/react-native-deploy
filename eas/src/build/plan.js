import { Platform } from '../easjson/types.js';

/**
 * Turns a resolved eas.json build profile into the set of inputs our GitHub
 * Actions workflow takes.
 *
 * This is where EAS's vocabulary meets Xcode's and Gradle's. EAS describes
 * *intent* — "internal distribution", "development client", "app bundle" — and
 * the runner needs concrete switches. Every translation below is a decision EAS
 * Build makes server-side; doing it here, in one pure function, is what makes it
 * testable without a runner.
 */

/**
 * `distribution` + `ios.simulator` + `enterpriseProvisioning` collapse into a
 * single Xcode export method.
 *
 *   store                        → app-store
 *   internal                     → ad-hoc          (devices in the profile)
 *   internal + universal         → enterprise      (in-house, no device list)
 *   simulator                    → (none — the archive is never exported)
 */
export function resolveIosExportMethod(profile) {
  if (profile.simulator) {
    return null;
  }
  if (profile.distribution === 'internal') {
    return profile.enterpriseProvisioning === 'universal' ? 'enterprise' : 'ad-hoc';
  }
  return 'app-store';
}

/**
 * EAS lets a profile say either *what* it wants (`buildType`) or *how* to get it
 * (`gradleCommand`). An explicit command always wins — that is the escape hatch
 * for projects with product flavours, where no generic task name is right.
 */
export function resolveGradleCommand(profile) {
  if (profile.gradleCommand) {
    return profile.gradleCommand;
  }
  // EAS's own default is an app bundle for store builds and an APK for anything
  // installed directly, because Play needs .aab and a device cannot install one.
  // EAS: developmentClient "sets gradleCommand to :app:assembleDebug" — the dev
  // launcher is a debug-build feature, so a release APK would not open Metro.
  if (profile.developmentClient) {
    return ':app:assembleDebug';
  }
  if (profile.buildType === 'apk') {
    return ':app:assembleRelease';
  }
  if (profile.buildType === 'app-bundle') {
    return ':app:bundleRelease';
  }
  return profile.distribution === 'internal' ? ':app:assembleRelease' : ':app:bundleRelease';
}

/** The artifact extension a profile will produce, used for naming downloads. */
export function resolveArtifactExtension(platform, profile) {
  if (platform === Platform.IOS) {
    return profile.simulator ? 'app' : 'ipa';
  }
  const command = resolveGradleCommand(profile);
  return /bundle/i.test(command) ? 'aab' : 'apk';
}

/**
 * EAS resource classes map onto GitHub runner labels. The names do not line up
 * one-to-one, so this is a judgement call rather than a lookup:
 *
 *   - EAS's iOS `default`/`medium` is a shared 4-core M-series box; `macos-26`
 *     (arm64, 3-core) is the closest standard runner and the only one covered by
 *     included minutes. It has to be macOS 26: its default Xcode is 26.x, and
 *     Expo SDK 55 does not compile on the Xcode 16.4 that `macos-15` defaults to.
 *   - `large`/`m-large` asks for more, which on GitHub means an `xlarge` runner.
 *     Those are NEVER covered by included minutes — they bill per-minute on
 *     every plan, so a profile asking for one is a deliberate cost decision.
 */
const IOS_RUNNERS = {
  default: 'macos-26',
  medium: 'macos-26',
  'm-medium': 'macos-26',
  'm1-medium': 'macos-26',
  large: 'macos-26-xlarge',
  'm-large': 'macos-26-xlarge',
};

const ANDROID_RUNNERS = {
  default: 'ubuntu-latest',
  medium: 'ubuntu-latest',
  large: 'ubuntu-latest-4-cores',
};

export function resolveRunner(platform, profile) {
  const resourceClass = profile.resourceClass ?? 'default';
  const table = platform === Platform.IOS ? IOS_RUNNERS : ANDROID_RUNNERS;
  return table[resourceClass] ?? table.default;
}

/** True when a runner-billed macOS box will cost per-minute regardless of plan. */
export function isPaidOnlyRunner(runner) {
  return /xlarge|large/.test(runner) && runner.startsWith('macos');
}

/**
 * Picks the install command from the committed lockfile, honouring any explicit
 * version pin in the profile.
 *
 * Using the project's real package manager is not cosmetic: resolving a bun or
 * pnpm project with npm produces a different tree than the developer tested
 * against, and silently skips `patch-package` and other postinstall steps.
 */
export function resolvePackageManager(profile, lockfiles = []) {
  const has = (name) => lockfiles.includes(name);
  if (profile.bun || has('bun.lock') || has('bun.lockb')) {
    return { name: 'bun', version: profile.bun ?? null, install: 'bun install --frozen-lockfile' };
  }
  if (profile.pnpm || has('pnpm-lock.yaml')) {
    return { name: 'pnpm', version: profile.pnpm ?? null, install: 'pnpm install --frozen-lockfile' };
  }
  if (profile.yarn || has('yarn.lock')) {
    return { name: 'yarn', version: profile.yarn ?? null, install: 'yarn install --immutable' };
  }
  return { name: 'npm', version: null, install: 'npm ci' };
}

/**
 * The full dispatch payload. Keys here are the workflow's `workflow_dispatch`
 * inputs — a contract test asserts the two stay in step, because a silent
 * mismatch would surface as an eight-minute build that signed the wrong thing.
 */
export function buildDispatchInputs({ platform, profile, ref, profileName, lockfiles = [], appConfig = {} }) {
  const common = {
    platform,
    profile: profileName,
    ref,
    node_version: profile.node ?? '20',
    corepack: String(Boolean(profile.corepack)),
    package_manager: resolvePackageManager(profile, lockfiles).name,
    // The runner reads env as a JSON blob rather than 20 separate inputs;
    // workflow_dispatch caps at 10 inputs and a profile can easily exceed that.
    env_json: JSON.stringify(profile.env ?? {}),
    channel: profile.channel ?? '',
    development_client: String(Boolean(profile.developmentClient)),
    prebuild_command: profile.prebuildCommand ?? '',
    cache_key: profile.cache?.key ?? '',
    cache_disabled: String(Boolean(profile.cache?.disabled)),
    distribution: profile.distribution ?? 'store',
    app_version: appConfig.version ?? '',
    // Shown on the install page for internal builds. iOS reads its identifiers
    // from the built IPA; Android's come from here, since the runner has no aapt.
    app_name: appConfig.name ?? '',
  };

  if (platform === Platform.IOS) {
    return {
      ...common,
      runner: resolveRunner(platform, profile),
      // Not appConfig.scheme: in Expo that is the deep-link URL scheme, not an
      // Xcode scheme. Empty means the runner resolves it after prebuild.
      scheme: profile.scheme ?? '',
      build_configuration: profile.buildConfiguration ?? (profile.developmentClient ? 'Debug' : 'Release'),
      export_method: resolveIosExportMethod(profile) ?? '',
      simulator: String(Boolean(profile.simulator)),
      without_credentials: String(Boolean(profile.withoutCredentials || profile.simulator)),
      cocoapods_version: profile.cocoapods ?? '',
      artifact_path: profile.applicationArchivePath ?? profile.artifactPath ?? '',
      auto_increment: String(profile.autoIncrement ?? false),
    };
  }

  return {
    ...common,
    runner: resolveRunner(platform, profile),
    gradle_command: resolveGradleCommand(profile),
    android_package: appConfig.android?.package ?? '',
    ndk_version: profile.ndk ?? '',
    artifact_path: profile.applicationArchivePath ?? profile.artifactPath ?? '',
    auto_increment: String(profile.autoIncrement ?? false),
  };
}

/**
 * Checks a profile can actually be built before anything is dispatched. Catching
 * these locally is the whole point — the alternative is finding out partway into
 * a billed macOS run.
 */
export function validateBuildable({ platform, profile, credentials = {} }) {
  const errors = [];

  if (platform === Platform.IOS) {
    if (profile.simulator && profile.distribution === 'store') {
      errors.push(
        'A simulator build cannot be distributed to the App Store. Set "distribution": "internal" ' +
          'on this profile, or drop "ios.simulator".'
      );
    }
    const needsSigning = !profile.simulator && !profile.withoutCredentials;
    if (needsSigning && credentials.ios === false) {
      errors.push(
        'This profile needs iOS signing credentials, but none are configured. Run "rnd credentials".'
      );
    }
  }

  if (platform === Platform.ANDROID) {
    const command = resolveGradleCommand(profile);
    if (profile.distribution === 'internal' && /bundle/i.test(command)) {
      errors.push(
        'An .aab cannot be installed on a device, so it is not usable for internal distribution. ' +
          'Set "android.buildType": "apk" on this profile.'
      );
    }
    if (!profile.withoutCredentials && credentials.android === false) {
      errors.push(
        'This profile needs an Android keystore, but none is configured. Run "rnd credentials".'
      );
    }
  }

  return errors;
}

/**
 * GitHub caps `workflow_dispatch` at ten top-level inputs, and a full build plan
 * has roughly twice that. So the plan travels as one JSON blob plus the handful
 * of fields that need to be readable on the run itself.
 *
 * `platform`, `profile` and `runner` stay broken out because the workflow needs
 * them before it can parse anything — `runs-on` is evaluated at job level, where
 * a `fromJSON` of another input is not yet available.
 */
export const MAX_WORKFLOW_DISPATCH_INPUTS = 10;

export function packForDispatch(plan, { dispatchId } = {}) {
  const { platform, profile, runner, ...rest } = plan;
  const packed = {
    dispatch_id: dispatchId ?? '',
    platform,
    profile,
    runner,
    config_json: JSON.stringify(rest),
  };
  if (Object.keys(packed).length > MAX_WORKFLOW_DISPATCH_INPUTS) {
    throw new Error(
      `Packed ${Object.keys(packed).length} workflow inputs, but GitHub allows at most ${MAX_WORKFLOW_DISPATCH_INPUTS}.`
    );
  }
  return packed;
}

/** The inverse, so tests and the run-name parser agree on the encoding. */
export function unpackDispatch(inputs) {
  const { config_json: configJson, ...rest } = inputs;
  return { ...rest, ...(configJson ? JSON.parse(configJson) : {}) };
}
