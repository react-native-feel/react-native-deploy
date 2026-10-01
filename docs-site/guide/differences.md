# Differences from EAS

rn-eas aims to be a drop-in for the **build** and **submit** half of EAS. Where it behaves
differently, it does so on purpose and says so at the command line.

## Held to by tests

| Claim | How it is tested |
|---|---|
| Your `eas.json` resolves identically | Differential tests run every fixture through this implementation **and** the real `@expo/eas-json`, asserting the resolved profiles and the rejections match |
| Commands and flags are the same | A contract test reads `eas-cli`'s `oclif.manifest.json` and checks every command id, alias, flag, short char, option list and default |
| The CLI and the runner agree | A workflow contract test checks every plan output the workflow reads is one the CLI sends, and pins signing, failure handling and install publishing |

## Deliberate differences

| EAS | rn-eas | Why |
|---|---|---|
| Expo account, `eas login` with SSO/browser | GitHub token | GitHub runs the builds |
| Builds on Expo's machines | Builds on GitHub-hosted runners in your repo | The point of the project |
| `eas build --local` | Refused | Use a runner, or `npx expo run:ios` |
| Credentials stored and generated on Expo's servers | Repository secrets; `eas credentials` reports, it does not create yet | See [Credentials](/guide/credentials) |
| `eas build:version:set`, remote version source | Refused; versions live in `app.json` | There is no version server |
| `eas submit --url` | Refused | `asc` uploads local files; download first |
| Android `eas submit` | Not wired up yet | Needs a Google Play service account, not `asc`. Upload the `.aab` to Play Console directly |
| `eas update`, `branch`, `channel`, `env`, `secret`, `webhook`, `workflow:run`, `deploy`, `metadata` | Recognised and refused with the alternative | They are Expo-hosted services. See [the list](/reference/commands#not-supported) |
| Internal distribution links on expo.dev | Install pages on your own Cloudflare Worker | See [Internal distribution](/guide/internal-distribution) |

## Not there yet

These are known gaps rather than design decisions:

- **`autoIncrement`** is read from the profile but not applied on the runner: every build uses the
  `buildNumber` / `versionCode` in `app.json`. App Store Connect rejects a second upload with the
  same build number, so bump it yourself before each store build for now.
- **`eas build --auto-submit`**, `--auto-submit-with-profile` and `--what-to-test` are accepted but
  do nothing. Run `eas build:download` and `eas submit --path …` after the build.
- **Credential setup** has no wizard; the manual steps are in [Credentials](/guide/credentials).
- **App extensions** (widgets, notification services) are not signed: one provisioning profile
  per build, applied to the app target.
- **`eas device:create`** prints the `asc` command to run rather than registering the device.
