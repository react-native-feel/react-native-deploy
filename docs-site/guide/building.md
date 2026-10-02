# Building

```sh
rnd build --platform ios --profile production
rnd build -p all -e preview --no-wait
```

`--platform` takes `ios`, `android` or `all` (the default). `--profile` defaults to `production`.

## What the build runs

The runner builds the **pushed commit** of your current branch, not your working tree. If you have
uncommitted changes, `rnd build` warns and builds what is on GitHub. Push first.

## Which artifact you get

The profile decides what comes out. These are EAS's own rules:

| Profile | iOS | Android |
|---|---|---|
| `distribution: "store"` (the default) | `.ipa`, App Store export | `.aab` |
| `distribution: "internal"` | `.ipa`, ad-hoc export | `.apk` (a device cannot install an `.aab`) |
| `ios.enterpriseProvisioning: "universal"` | `.ipa`, enterprise export | — |
| `ios.simulator: true` | unsigned `.app`, tarred (`*-simulator.tar.gz`) | — |
| `developmentClient: true` | `Debug` configuration | `:app:assembleDebug` |
| `android.buildType` / `android.gradleCommand` | — | an explicit command always wins |
| `ios.buildConfiguration` | wins over the defaults above | — |

## Checked before anything is dispatched

A misconfigured profile fails locally in a second instead of eight minutes into a billed macOS
job:

- a simulator build with `distribution: "store"`;
- an Android internal build that would produce an `.aab`.

`rnd config -p ios -e <profile>` prints the profile as the runner will receive it, after
`extends`, platform blocks and defaults are applied. Start there when a build does something
unexpected.

## Runners

| `resourceClass` | iOS | Android |
|---|---|---|
| default, `medium`, `m-medium`, `m1-medium` | `macos-26` | `ubuntu-latest` |
| `large`, `m-large` | `macos-26-xlarge` (always billed per minute) | `ubuntu-latest-4-cores` |

iOS builds need `macos-26`: Expo SDK 55 does not compile with the Xcode 16.4 that `macos-15`
defaults to.

## Environment and versions

- `env` from the profile is exported before the app config is read, so an `app.config.js` that
  branches on `APP_VARIANT` resolves on the runner the way it does locally.
- `node` pins the Node version (default 20).
- The package manager follows your lockfile: `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, else
  `npm ci`. A profile's `bun`, `pnpm` or `yarn` field selects that manager too.
- `cache.key` and `cache.disabled` control the CocoaPods cache.

::: warning Build numbers
`autoIncrement` is not applied yet. Each build uses `ios.buildNumber` / `android.versionCode`
from `app.json`. Bump them before each build you upload to a store.
:::

## Following a build

```sh
rnd build:list --platform ios --limit 5
rnd build:view <id | id-prefix | run-id>
rnd build:cancel <id>
rnd build:download --platform android          # latest Android build → ./build/<id>.zip
rnd build:download --build-id <id> --output ./out
```

Every build also links to its GitHub Actions run, where the raw logs live, and appears in the
[dashboard](/guide/dashboard).
