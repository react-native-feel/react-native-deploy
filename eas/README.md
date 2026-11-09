# @react-native-feel/deploy (`rnd`)

**A drop-in EAS replacement.** The `eas` commands as `rnd`, reading the same
`eas.json`, with builds running on GitHub Actions runners and store delivery
handled by the [`asc`](https://github.com/rork/asc) CLI. No Expo account, no
Expo servers, no per-build fee — the compute is billed to your GitHub account
and the signing assets stay in your repo's secrets.

```bash
rnd build --platform ios --profile production
rnd build:list --json
rnd submit --profile production --path build/MyApp.ipa
```

Apart from the command name, that is what you already run with `eas`. That is the point.

**Docs:** https://reactnativefeel.com/deploy/docs/ (source in [`../docs-site`](../docs-site)).

---

## What "drop-in" is allowed to mean

A replacement that *mostly* reads your `eas.json` is worse than no replacement,
because the gap only shows up on the build that mattered. So compatibility here
is a tested property rather than an intention:

| Claim | How it is held to |
|---|---|
| Your `eas.json` resolves identically | 164 **differential tests** run every fixture through both this implementation and the real `@expo/eas-json` off npm, asserting the resolved profiles are deep-equal and the rejections match |
| The commands and flags are the same | A **contract test** reads `eas-cli`'s own `oclif.manifest.json` and asserts every command id, alias, flag, short char, option list and default lines up |
| The CLI and the runner agree | A **workflow contract test** compares the dispatch payload the CLI packs against the inputs the workflow declares, and checks every `steps.plan.outputs.X` the YAML reads is one the CLI actually sends |
| The dashboard and `--json` agree | Both call the **same mapper**. There is one projection from a workflow run to a Build record, imported by the CLI and the web app alike |

`npm test` runs 548 of these; the dashboard adds 29 more.

Pinning against the real packages means an upgrade that changes EAS's semantics
turns the suite red, which is the only way "drop-in" stays true past the day it
was written.

---

## How it works

```
rnd build  ──►  resolve eas.json profile   (same resolver as EAS)
           ──►  translate to runner switches (distribution → export method, …)
           ──►  workflow_dispatch  ──►  GitHub Actions runner
           ──►  poll the run, download the artifact

rnd submit ──►  resolve submit profile
           ──►  asc builds upload  ──►  App Store Connect
           ──►  asc builds add-groups  ──►  TestFlight
```

There is no server in the middle. **A build *is* a workflow run** — its status,
its artifacts, its step timings. `rnd build:list` reads the GitHub Actions API
and projects each run onto EAS's `BuildFragment` shape, which is why
`rnd build:list --json` can be piped into anything that already understood EAS.

Build ids are a SHA-256 of `repo#runId`, formatted as a v4-shaped UUID. They are
stable, need nothing persisted, and are derived identically in Node and in the
browser — the hash is a [50-line isomorphic implementation](src/models/sha256.js)
rather than `node:crypto`, precisely so the dashboard computes the same id.

---

## Install

```bash
npm install -g @react-native-feel/deploy   # puts `rnd` on your PATH
# or, without installing: npx @react-native-feel/deploy <command>
```

Prerequisites: Node 20+, a GitHub repo holding your app, and `asc` for anything
touching the App Store.

`rnd` sends anonymous usage stats: which commands and flags run, never their
values, paths or anything from your project. Opt out with `DO_NOT_TRACK=1`.
[What is sent](https://reactnativefeel.com/deploy/docs/guide/telemetry).

## Getting started

```bash
cd ~/code/my-app

rnd login              # stores a GitHub token at ~/.eas-gh/auth.json (0600)
rnd build:configure    # writes eas.json + .github/workflows/eas-build.yml
git add .github && git commit -m "add build workflow" && git push
rnd build --platform ios --profile development
```

If you already have an `eas.json`, skip `build:configure` and go straight to
`rnd build` — that file is the input, not something this tool rewrites.

---

## eas.json support

Every field in EAS's build and submit schemas is parsed and validated, including
the parts that are easy to get subtly wrong:

- **JSON5.** Comments and trailing commas are accepted, and `rnd build:configure`
  patches the file in place rather than reserialising it, so your comments survive.
- **`extends` chains**, capped at five deep, with `env` and the platform blocks
  merged rather than replaced.
- **Platform overrides.** A top-level `distribution` with an `ios` block that
  overrides `credentialsSource` resolves exactly as EAS resolves it.
- **`$VAR` indirection** in `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`
  and `serviceAccountKeyPath` — those four fields and no others, matching EAS.
- **Schema defaults**: `credentialsSource: "remote"`, `distribution: "store"`,
  `track: "internal"`, `language: "en-US"`, and the rest.

`rnd config --platform ios --profile production` prints what a profile actually
resolves to, which is usually not what the file looks like.

### How profiles reach the runner

| eas.json | Effect on the build |
|---|---|
| `distribution: "store"` | iOS exports `app-store`; Android builds an `.aab` |
| `distribution: "internal"` | iOS exports `ad-hoc`; Android builds an `.apk`, because a device cannot install an `.aab` |
| `ios.enterpriseProvisioning: "universal"` | iOS exports `enterprise` |
| `ios.simulator: true` | Unsigned `.app`, tarred to preserve the bundle; credentials skipped |
| `android.buildType` / `android.gradleCommand` | An explicit command always wins |
| `resourceClass: "large"` \| `"m-large"` | `macos-26-xlarge` — **never** covered by included minutes, so the CLI warns |
| `resourceClass` anything else | `macos-26` |
| `node` / `yarn` / `pnpm` / `bun` / `corepack` | Pinned on the runner; the install command follows your committed lockfile |
| `env` | Exported **before** the app config is read, so an `app.config.js` branching on `APP_VARIANT` resolves correctly |
| `cache.key` / `cache.disabled` | Pods cache key on the runner |

Profiles are checked before anything is dispatched — a simulator build aimed at
the App Store, or an `.aab` marked for internal distribution, fails locally in a
second rather than eight minutes into a billed macOS job.

---

## Commands

Everything below takes the same flags as `eas-cli`, verified against its manifest.

| Command | Notes |
|---|---|
| `rnd build` | `-p/--platform`, `-e/--profile`, `--wait/--no-wait`, `--clear-cache`, `-m/--message`, `--json`, … (`--auto-submit` is accepted but not implemented yet) |
| `rnd build:list` | All of EAS's filters, including the camelCase aliases |
| `rnd build:view [ID]` | Accepts a full id, an id prefix, or a raw run id |
| `rnd build:cancel [ID]` | Stops the run, and the billing with it |
| `rnd build:download` | Pulls the artifact zip |
| `rnd build:configure` | Writes `eas.json` and the workflow |
| `rnd submit` (alias `rnd build:submit`) | Uploads via `asc`, adds TestFlight groups |
| `rnd submit:status` | Live version and recent TestFlight builds |
| `rnd credentials` | Reports which signing secrets the repo holds |
| `rnd config` | The resolved profile |
| `rnd project:info` | What this tool sees in your project |
| `rnd login` / `logout` / `whoami` | The stored GitHub token |

Commands that only make sense against Expo's servers — `rnd update`, `rnd env`,
`rnd secret`, `rnd workflow:run`, `rnd deploy` — are recognised and answered with
what to use instead, rather than an "unknown command".

### Deliberate differences

- **`rnd build --local` is refused.** The whole point is that the macOS runner is
  GitHub's.
- **`rnd submit --url` is refused.** `asc` uploads from a local file; download the
  archive first.
- **Android submission is not wired up.** It needs a Google Play service account
  rather than `asc`. The `.aab` from `rnd build` uploads to the Play Console
  unchanged in the meantime.
- **`rnd build:version:set` is refused.** Versions live in your app config, not on
  a server — edit `app.json` or set `autoIncrement` on the profile.

---

## Credentials

Signing assets are GitHub repo secrets, sealed client-side against the repo's
public key. GitHub never sees a plaintext value.

| Secret | Contents |
|---|---|
| `EAS_IOS_DIST_P12` | base64 `.p12` (distribution cert + private key) |
| `EAS_IOS_P12_PASSWORD` | password for that `.p12` |
| `EAS_IOS_PROFILE` | base64 `.mobileprovision` |
| `EAS_ANDROID_KEYSTORE` | base64 PKCS12 keystore |
| `EAS_ANDROID_STORE_PASSWORD` / `_KEY_ALIAS` / `_KEY_PASSWORD` | keystore details |

On the runner, the iOS assets are imported into a throwaway keychain in
`$RUNNER_TEMP` and deleted in an `always()` step — never the login keychain,
which survives between jobs on some images. Android signing is injected through
`-Pandroid.injected.signing.*`, so your Gradle files are never edited.

**Back up your Android keystore.** It is the only thing that can sign updates to
a published Play listing.

---

## The dashboard

[`../web`](../web) is a Vite app that reproduces expo.dev's deploy screens —
project overview, builds list with filters, build detail with the phase
timeline, and the install modal with its QR code. It reads the GitHub Actions API
directly from the browser with your own token, and ships with demo data so it
renders before you connect anything.

```bash
cd ../web && npm install && npm run dev
```

## Cost

Runner minutes come out of your GitHub account. macOS is 10× against included
minutes on private repos — a Free plan's 2,000/mo is about 200 macOS minutes —
and free on public ones. A typical RN iOS archive is 8–15 minutes; Android on
Ubuntu is 4–8 and effectively free.

## Layout

```
eas/
├── bin/rnd.js
├── src/
│   ├── easjson/      faithful port of @expo/eas-json (schema, resolvers, accessor)
│   ├── cli/          declarative command spec + commander program
│   ├── commands/     build, submit, misc
│   ├── build/        profile → runner translation, service over the Actions API
│   ├── submit/       asc integration
│   ├── models/       Build and Submission records, isomorphic sha256
│   ├── github/       REST client, auth
│   └── utils/        logger, project context
├── templates/eas-build.yml
└── test/             548 tests
```

## License

[MIT](../LICENSE)
