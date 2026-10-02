# Workflow, secrets & variables

`rnd build:configure` copies `eas/templates/eas-build.yml` to `.github/workflows/eas-build.yml`.
The CLI never rewrites it: every decision arrives as a dispatch input, so you can also start a
build by hand from the repository's **Actions** tab.

::: tip Keep it current
Workflow fixes ship in the template, not in your repository. After upgrading React Native Deploy, copy the
template over your workflow and push.
:::

## Inputs

GitHub allows at most ten `workflow_dispatch` inputs, so the resolved plan travels as one JSON
blob.

| Input | Contents |
|---|---|
| `dispatch_id` | Random UUID; stamped into the run name so the CLI can find the run, and keys the install page |
| `platform` | `ios` or `android` |
| `profile` | Build profile name |
| `runner` | Runner label, from `resourceClass` |
| `config_json` | The resolved build plan: export method, configuration, scheme, Gradle task, toolchain, env, app name and version, … |

## Steps

| Step | Runs when | Does |
|---|---|---|
| Prepare project | always | Unpacks `config_json` into step outputs |
| Checkout | always | Full history (some `expo-updates` runtime versions depend on it) |
| Read eas.json | always | Fails early if the commit has no `eas.json` |
| Export build environment | always | Exports the profile's `env` before anything reads the app config |
| Set up Node / package manager | always | Node version and package manager from the plan |
| Install JS dependencies | always | `npm ci`, `yarn install --immutable`, `pnpm install --frozen-lockfile` or `bun install --frozen-lockfile` |
| Set up JDK / Android SDK | Android | Temurin 17, `android-actions/setup-android@v4` |
| Select Xcode | iOS | Pins `/Applications/Xcode.app` |
| Prebuild | always | `expo prebuild`, or `prebuildCommand`; skipped when `ios/` or `android/` is committed |
| Restore pods cache / Install pods | iOS | Keyed by `cache.key` and `Podfile.lock` |
| Resolve Xcode scheme | iOS | The profile's `scheme`, else the only `ios/*.xcworkspace` |
| Import signing credentials | iOS, signed builds | Throwaway keychain; picks `EAS_IOS_PROFILE` or `EAS_IOS_PROFILE_INTERNAL` by export method |
| Apply signing settings | iOS device builds | Manual signing on the target that builds the profile's bundle id |
| Archive (iOS) / Export IPA | iOS device builds | `xcodebuild archive` and `-exportArchive` with the profile mapping |
| Build for simulator (iOS) | iOS simulator builds | Unsigned `.app`, tarred to keep the bundle intact |
| Build (Android) | Android | The Gradle task; keystore injected when present |
| Publish for install | internal device builds, `EAS_INSTALL_URL` set | Multipart upload to the install service; adds an install link to the run summary |
| Upload application archive | always | Artifact `application-archive`, kept 90 days |
| Upload Xcode logs | iOS, even on failure | Artifact `xcode-logs` |
| Clean up credentials | iOS, even on failure | Deletes the keychain and installed profiles |

Runs are grouped per platform, profile and branch with `concurrency`, and nothing is cancelled
automatically: a second build of the same profile waits for the first.

## Secrets

| Secret | Needed for |
|---|---|
| `EAS_IOS_DIST_P12`, `EAS_IOS_P12_PASSWORD` | Signed iOS builds |
| `EAS_IOS_PROFILE` | iOS store builds |
| `EAS_IOS_PROFILE_INTERNAL` | iOS internal builds |
| `EAS_ANDROID_KEYSTORE`, `EAS_ANDROID_STORE_PASSWORD`, `EAS_ANDROID_KEY_ALIAS`, `EAS_ANDROID_KEY_PASSWORD` | Android release signing (optional; debug key otherwise) |
| `EAS_INSTALL_TOKEN` | Publishing internal builds |

How to create each one: [Credentials](/guide/credentials).

## Variables

| Variable | Effect |
|---|---|
| `EAS_INSTALL_URL` | Base URL of the [install service](/guide/dashboard). When unset, internal builds are not published |
