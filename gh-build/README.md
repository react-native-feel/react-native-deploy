# rn-build

**Build loop.** Run React Native iOS *and* Android builds on GitHub Actions runners, signed and downloadable, without owning a Mac — an EAS Build replacement where the compute is billed to your own GitHub account instead of Expo's.

> Siblings in this repo: [`rn-deploy`](../README.md) builds on an AWS EC2 Mac you rent per build; [`rn-preview`](../sim-preview/README.md) streams a live simulator to your browser. They're independent tools — see the root README for which to reach for.

## What it does

```
rn-build setup     → generates signing assets, encrypts them into repo secrets,
                     writes .github/workflows/rn-build.yml
rn-build build     → dispatches the workflow, follows it step by step,
                     downloads the .ipa / .aab into ./build
```

No Mac at any point. The iOS signing key is generated locally with `openssl`, Apple only ever sees a CSR, and the resulting `.p12` reaches the runner as an encrypted GitHub secret.

## Cost

Runner minutes come out of *your* GitHub account:

| Repo | macOS (iOS) | Ubuntu (Android) |
|---|---|---|
| **Public** | free on standard runners | free |
| **Private** | 10× multiplier against included minutes — a Free plan's 2,000/mo ≈ **200 macOS minutes** — then per-minute | 1× |

Larger macOS runners (`macos-15-xlarge`, arm64/M2 — noticeably faster for Xcode) are **never** covered by included minutes; they always bill per-minute. Check current rates at [GitHub's Actions billing docs](https://docs.github.com/en/billing/managing-billing-for-github-actions).

A typical RN iOS archive takes 8–15 minutes on `macos-15`. Android on `ubuntu-latest` is 4–8 minutes and effectively free.

## Prerequisites

**On your machine** (any OS — Linux and Windows included):
- Node.js 20+
- `openssl` — preinstalled on macOS/Linux
- `keytool` — ships with any JDK (`brew install openjdk@17`), Android only
- [`asc`](https://github.com/rofi/asc) — the App Store Connect CLI, iOS only
- `unzip` — for artifact extraction

**Accounts:**
- A GitHub repo holding your app, and a PAT with `repo` + `workflow` scopes
- An Apple Developer account with an App Store Connect API key (`.p8`), authenticated via `asc auth login`

## Install

```bash
cd gh-build
npm install
npm link          # puts `rn-build` on your PATH
```

## Setup

Run this from inside your React Native project:

```bash
cd ~/code/my-app
rn-build setup
```

It walks six steps:

1. **GitHub auth** — prompts for a PAT, verifies the scopes, stores it at `~/.rn-build/auth.json` (mode 0600). Never written into the project.
2. **Repository** — defaults to your `origin` remote and current branch. Prints the billing model for that repo's visibility.
3. **App details** — reads `app.json` / `package.json` to propose the app name, bundle ID, package name, and Xcode scheme; detects whether it's an `expo` (prebuild) or `classic` (native dirs committed) project; picks the package manager from the committed lockfile; and imports per-profile `env` from an existing `eas.json`.
4. **iOS signing** — generates a 2048-bit key and CSR locally, has App Store Connect issue a distribution certificate against it, registers the bundle ID, creates and downloads a provisioning profile, bundles a `.p12`, and pushes three encrypted secrets.
5. **Android signing** — generates a PKCS12 release keystore with `keytool` (or imports one you already have, so an existing Play listing keeps signing), then pushes four encrypted secrets.
6. **Workflow + config** — writes `.github/workflows/rn-build.yml` and `rn-build.config.json`, and offers to commit the workflow for you.

The Team ID is read out of the certificate's subject `OU` field, so you never have to look it up.

## Daily use

```bash
rn-build build                                  # production profile, both platforms
rn-build build --profile preview --platform ios
rn-build build --ref release/2.1 --gradle-task bundleRelease
rn-build build --detach                         # dispatch and get on with your day
```

Output looks like:

```
› Dispatching production build of me/my-app@main
    platform    all
    scheme      MyApp (Release, app-store)
    ios runner  macos-15

✓ Run #42 started
    https://github.com/me/my-app/actions/runs/1234567890

  ✓ ios › Install JS dependencies (48s)
  ✓ ios › Install CocoaPods dependencies (2m11s)
  ✓ ios › Import signing certificate and provisioning profile (3s)
  ✓ ios › Archive (7m02s)
  ✓ android › Build (4m18s)

✓ Build succeeded in 11m26s
✓ /Users/me/code/my-app/build/MyApp.ipa (42.7 MB)
✓ /Users/me/code/my-app/build/app-release.aab (28.1 MB)
```

Ctrl-C only detaches your terminal — the run keeps going and keeps billing. Use `rn-build cancel` to actually stop it.

## Commands

| Command | Description |
|---|---|
| `rn-build login` / `logout` / `whoami` | Manage the stored GitHub token |
| `rn-build setup` | Interactive first-time setup |
| `rn-build build` | Dispatch, follow, and download a build |
| `rn-build status [--watch] [--download]` | Re-attach to the last run |
| `rn-build cancel` | Cancel the last run to stop billing |
| `rn-build workflow init [--push]` | (Re)write the workflow file locally |
| `rn-build workflow push` | Commit the workflow via the GitHub API |
| `rn-build credentials list` | Show which signing secrets the repo has |
| `rn-build credentials rotate-ios` | New certificate + profile, secrets updated |
| `rn-build credentials rotate-android` | New or imported keystore |
| `rn-build credentials clear` | Delete every rn-build secret from the repo |

### `rn-build build` flags

| Flag | Description | Default |
|---|---|---|
| `--profile <name>` | Build profile from config | `production` |
| `--platform <p>` | `ios` \| `android` \| `all` | from profile |
| `--ref <branch>` | Branch or tag to build | from config |
| `--gradle-task <task>` | `assembleRelease`, `bundleRelease`, … | from profile |
| `--ios-runner <label>` | e.g. `macos-15-xlarge` for a faster (paid) runner | `macos-15` |
| `--android-runner <label>` | | `ubuntu-latest` |
| `--output <dir>` | Where artifacts land | `./build` |
| `--detach` | Dispatch and exit without waiting | `false` |

## Configuration

`rn-build.config.json` is written by `setup` and is safe to commit — it holds no secrets.

```jsonc
{
  "github": { "repo": "me/my-app", "ref": "main" },
  "ios": {
    "bundleId": "com.me.myapp",
    "scheme": "MyApp",
    "teamId": "ABCDE12345",       // read from the certificate
    "profileName": "MyApp app-store (rn-build)"
  },
  "android": { "package": "com.me.myapp", "module": "app" },
  "build": {
    "production": {
      "platform": "all",
      "buildType": "expo",
      "buildConfiguration": "Release",
      "distribution": "app-store",
      "gradleTask": "bundleRelease",
      "iosRunner": "macos-15",
      "env": { "API_URL": "https://api.example.com" }
    },
    "preview":     { "extends": "production", "distribution": "ad-hoc", "gradleTask": "assembleRelease" },
    "development": { "extends": "production", "buildConfiguration": "Debug", "distribution": "development" }
  }
}
```

Profiles inherit via `extends` — nearest override wins, and `env` maps merge rather than replace.

### Coming from EAS

`setup` reads an existing `eas.json` and copies each matching profile's `env`
block across. That matters more than it looks: an `app.config.js` that branches
on `APP_VARIANT` resolves at prebuild time, so a "production" build missing that
variable quietly ships the development icon, splash, and API host. Anything
already set in `rn-build.config.json` wins over the imported value.

Nothing else from `eas.json` is imported — `channel`, `autoIncrement`,
`appVersionSource`, and `distribution: internal` describe EAS infrastructure
with no equivalent here. In particular there is **no `autoIncrement`**: App
Store Connect rejects a duplicate build number, so bump `expo.version` /
`ios.buildNumber` yourself before a production build.

### Package managers

The install step follows the committed lockfile — `bun.lock` → `bun install
--frozen-lockfile`, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise `npm
ci`. A `packageManager` field in `package.json` overrides the guess. Using the
real manager is what keeps `patch-package` and other postinstall steps working;
resolving a bun project with npm gives you a different tree than you develop
against.

## Secrets

`setup` creates these in the repo. They are sealed client-side with libsodium against the repo's public key; GitHub never sees a plaintext value, and neither does anything on disk after setup finishes.

| Secret | Contents |
|---|---|
| `RN_BUILD_IOS_DIST_P12` | base64 `.p12` (distribution cert + private key) |
| `RN_BUILD_IOS_P12_PASSWORD` | random 18-byte password for that `.p12` |
| `RN_BUILD_IOS_PROFILE` | base64 `.mobileprovision` |
| `RN_BUILD_ANDROID_KEYSTORE` | base64 PKCS12 keystore |
| `RN_BUILD_ANDROID_STORE_PASSWORD` | keystore password |
| `RN_BUILD_ANDROID_KEY_ALIAS` | key alias (default `upload`) |
| `RN_BUILD_ANDROID_KEY_PASSWORD` | key password |

**Back up your Android keystore.** It is the only thing that can sign updates to a published Play listing, and `credentials rotate-android` will not help you after the fact.

## How the workflow signs

`.github/workflows/rn-build.yml` is static and entirely input-driven, so the CLI never rewrites it and you can run builds by hand from the Actions tab.

- **iOS** — creates a throwaway keychain in `$RUNNER_TEMP`, imports the `.p12`, drops the profile into `~/Library/MobileDevice/Provisioning Profiles/`, renders `ExportOptions.plist` from the dispatch inputs, then `xcodebuild archive` + `-exportArchive` with `CODE_SIGN_STYLE=Manual`. The keychain is deleted in an `always()` step.
- **Android** — decodes the keystore to `$RUNNER_TEMP` and passes `-Pandroid.injected.signing.*` to Gradle, which AGP honours for any `assemble`/`bundle` task. Your app's Gradle files are never edited.

## Troubleshooting

**`.github/workflows/rn-build.yml is not on repo@ref yet`** — GitHub can only dispatch a workflow that exists on the branch. Commit and push it, or run `rn-build workflow push`.

**`Your GitHub token can't write workflow files`** — the PAT needs `workflow` on top of `repo`. Re-run `rn-build login` with a new token.

**`Apple allows only two active distribution certificates per team`** — both slots are used, likely by certs whose private keys live on a machine you no longer have. Revoke one:
```bash
asc certificates list --certificate-type IOS_DISTRIBUTION
asc certificates revoke --id CERT_ID --confirm
```

**`A provisioning profile named "…" already exists`** — pass a different name via `rn-build credentials rotate-ios`, or delete the old one with `asc profiles delete`.

**Archive fails with "No signing certificate found"** — the profile and certificate have to match. Run `rn-build credentials rotate-ios` to regenerate both together.

**Build succeeded but no artifacts** — check the scheme name in `rn-build.config.json`; `xcodebuild` will happily archive a different target and export nothing.

**Dispatched but the CLI can't find the run** — the workflow on your branch is out of date and no longer stamps `dispatch_id` into `run-name`. Run `rn-build workflow push`.

## Layout

```
gh-build/
├── bin/rn-build.js
├── src/
│   ├── cli.js
│   ├── commands/         setup, build, login, workflow, credentials
│   ├── github/           api, auth, secrets (sealed box), contents, runs, artifacts
│   ├── credentials/      ios (openssl + asc), android (keytool)
│   ├── config/           schema, profiles, loader
│   └── utils/            logger, exec, prompts, detect
├── templates/
│   ├── rn-build.yml            ← the workflow, copied verbatim into your repo
│   └── rn-build.config.json
└── test/                 24 tests, including a CLI↔workflow input contract test
```

Run them with `npm test`.

## Not yet wired

- **TestFlight / Play submission.** This is the build loop only; `rn-deploy submit` still expects an EC2 Mac. A `rn-build submit` step using `asc builds upload` from the runner is the obvious next seam.
- **Simulator builds.** Producing an unsigned `.app` for `generic/platform=iOS Simulator` would let `rn-preview` install the result directly — the missing link between all three tools.

## License

ISC
