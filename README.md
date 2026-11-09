# React Native Deploy

[![npm](https://img.shields.io/npm/v/@react-native-feel/deploy?label=%40react-native-feel%2Fdeploy)](https://www.npmjs.com/package/@react-native-feel/deploy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-reactnativefeel.com%2Fdeploy%2Fdocs-4f46e5)](https://reactnativefeel.com/deploy/docs/)

Ship React Native and Expo apps — builds, TestFlight, and installs on test devices — without
owning a Mac or paying per build. Free and open source (MIT).

```sh
npm install -g @react-native-feel/deploy
rnd build:configure          # writes eas.json + .github/workflows/eas-build.yml
rnd build --platform ios --profile production
rnd submit --profile production --path build/MyApp.ipa
```

**Documentation:** [reactnativefeel.com/deploy/docs](https://reactnativefeel.com/deploy/docs/) ·
**Getting started:** [guide](https://reactnativefeel.com/deploy/docs/guide/getting-started) ·
**Commands:** [reference](https://reactnativefeel.com/deploy/docs/reference/commands)

This repository holds two build CLIs that read the same `eas.json`, plus the dashboard and
install service they share.

| | **`rnd`** ([`eas/`](eas/README.md)) | **`rn-deploy`** (this directory, [below](#rn-deploy)) |
|---|---|---|
| In one line | The same `eas` commands, running on **GitHub Actions** | An EAS-compatible pipeline on **a Mac you point it at** |
| Where builds run | GitHub-hosted `macos-26` / `ubuntu-latest` runners in your repo | AWS EC2 Mac (provisioned per build), MacinCloud or any SSH-reachable Mac, a cua cloud sandbox, or a GitHub runner (simulator builds) |
| Command surface | Drop-in for `eas-cli`'s build/submit commands and flags (contract-tested) | `rn-deploy setup` / `build` / `submit` / `infra` / `install` |
| Signing | Repo secrets; ad-hoc profile regenerated per build from a device registry (`rnd device:create` QR) | `asc` keychain + signing fetch/sync on the host |
| Android | Yes (`.apk` / `.aab`) | No |
| Pay for | GitHub Actions minutes (free on public repos) | the Mac: EC2 host time, a MacinCloud rental, … |
| Pick it when | you want `eas build` without Expo's servers | you already rent a Mac, or need a full Mac rather than a runner |

Both read `eas.json` and `app.json`, sign with your App Store Connect API key through
[`asc`](https://github.com/rork/asc), and upload to TestFlight.

## Shared pieces

| | Where | What |
|---|---|---|
| **Dashboard & install service** | [`web/`](web/README.md) — live at [react-native-deploy.pages.dev](https://react-native-deploy.pages.dev) | Vite dashboard (builds, build detail, Install QR) and the Cloudflare Pages app that serves it, the public `/install/<id>` pages (itms-services on iOS, APK on Android, QR on desktop) and the R2 upload API |
| **`rnd` docs** | [`docs-site/`](docs-site/) — [reactnativefeel.com/deploy/docs](https://reactnativefeel.com/deploy/docs/) | VitePress site; the command reference is generated from the CLI's spec |
| **rn-deploy docs** | [`rnd-docs/`](rnd-docs/README.md) | Fumadocs site |
| **Release test** | [`docs/release-testing/`](docs/release-testing/) | End-to-end test of `rnd` as a new user, bugs found and fixed |

```bash
cd eas && npm install && npm test          # rnd CLI
cd web && npm install && npm test          # dashboard + install service
npm test                                   # rn-deploy (repo root)
```

## Other tools in this repo

Smaller, independent tools that predate the two CLIs and solve adjacent problems:

| | Where | What |
|---|---|---|
| **`rn-build`** | [`gh-build/`](gh-build/README.md) | The direct ancestor of `rnd`: GitHub Actions builds with its own `rn-build.config.json` instead of `eas.json` |
| **`rn-preview`** | [`sim-preview/`](sim-preview/README.md) | A booted iOS Simulator on a rented Mac (MacinCloud), streamed to your browser with `baguette` |

---

# rn-deploy

Build React Native iOS apps on a remote Mac (AWS EC2 Mac or MacinCloud) and ship them to TestFlight, the App Store, or via OTA install pages — without owning a Mac.

`rn-deploy` is a self-hosted, EAS-compatible build pipeline. Point it at a repo, it provisions (or reuses) a Mac, runs your Expo or classic React Native build there, signs with your App Store Connect credentials, and either uploads to TestFlight or publishes a signed `.ipa` to your own R2/S3 bucket with a QR install page.

## Install

```sh
npm install -g rn-deploy
```

Requires Node ≥ 18.17. iOS builds need an [`asc`](https://github.com/rork/asc) install for App Store Connect auth, plus AWS credentials (or an SSH-reachable Mac) for the remote build host.

## Quickstart

```sh
# 1. One-time interactive setup — writes deploy.config.json
rn-deploy setup

# 2. Store your App Store Connect API key in the macOS keychain
rn-deploy credentials configure

# 3. Provision an EC2 Mac (skip if using your own SSH-reachable Mac)
rn-deploy infra up

# 4. Build + auto-submit to TestFlight
rn-deploy build --profile production --auto-submit

# 5. Tear down the instance when done
rn-deploy infra down
```

## Commands

| Command                       | What it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `rn-deploy setup`             | Interactive first-time setup (`deploy.config.json`)    |
| `rn-deploy build`             | Build the app on the remote Mac                        |
| `rn-deploy submit`            | Upload an `.ipa` to TestFlight                         |
| `rn-deploy builds list`       | List previously published builds from the registry    |
| `rn-deploy install`           | Install a previously published build (skip rebuilding) |
| `rn-deploy credentials *`     | Manage App Store Connect API keys (via `asc` keychain) |
| `rn-deploy infra up\|down\|status` | Provision / tear down EC2 Mac infrastructure       |

Run `rn-deploy <command> --help` for full flags.

## Configuration

`rn-deploy` reads `deploy.config.json` from your project root. It follows EAS-style profile inheritance — `preview` and `development` `extends: "production"` by default. See `templates/deploy.config.json` for the full shape.

### Build host

The `host` block picks where builds run. Four kinds are supported:

```jsonc
// AWS EC2 Mac — provisioned and torn down per build (default)
"host": { "kind": "aws" }   // AWS settings live in the "aws" block

// MacinCloud or any SSH-reachable Mac you already own
"host": {
  "kind": "macincloud",
  "host": "TX0XX.macincloud.com",
  "port": 22,
  "user": "userXXXXXX",
  "password": "${MAC_PASSWORD}",   // or "privateKey": "~/.ssh/id_rsa"
  "workDir": "~/rn-deploy-work"
}

// GitHub Actions — build on a macOS runner via a workflow
"host": {
  "kind": "github-actions",
  "repo": "owner/name",
  "workflow": "rn-deploy.yml",
  "ref": "main"
}

// cua — a cloud macOS sandbox driven over the @trycua/computer SDK
"host": {
  "kind": "cua",
  "name": "your-cua-sandbox-name",   // created via the cua CLI/dashboard
  "osType": "macos",
  "apiKey": "${CUA_API_KEY}",        // defaults to ${CUA_API_KEY}; export it
  "workDir": "~/rn-deploy-work"
}
```

Differences with `kind: "macincloud"`:

- **No infra lifecycle** — `rn-deploy` never provisions or tears down the machine (`infra up`/`down` are AWS-only). It connects, builds, and disconnects.
- **No sudo required** — the host is verified rather than provisioned. Xcode, Node, git, and CocoaPods must already be installed; the build fails with guidance if any are missing.
- **Password or key auth** — set either `password` or `privateKey`.
- **Secrets stay out of git** — any `${VAR}` in the host block is read from the environment at load time. Keep the literal `${MAC_PASSWORD}` in `deploy.config.json` and export the real value (e.g. from a gitignored `.env`).

With `kind: "github-actions"`:

- `rn-deploy build` dispatches the workflow with `gh`, waits for the run, then prints the published build's links. Requires the [`gh` CLI](https://cli.github.com/) authenticated locally.
- The build runs on the runner via `rn-deploy run-build` (the build command, but local instead of over SSH). Copy [`templates/github/rn-deploy.yml`](./templates/github/rn-deploy.yml) into `.github/workflows/` and set `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` as repo secrets.
- Currently supports `distribution: "simulator"` (unsigned, no Apple credentials). Signed device builds on a runner are a follow-up.

With `kind: "cua"`:

- Builds run on a [cua](https://cua.ai) **cloud macOS sandbox**, driven over cua's TypeScript SDK (`@trycua/computer`) instead of SSH. rn-deploy connects, builds, and disconnects — it never provisions or stops the sandbox (manage its lifecycle via the cua CLI/dashboard).
- Install the optional SDK (`npm install @trycua/computer`), create a sandbox and note its **name**, then export your `CUA_API_KEY`. Like `macincloud`, the host is verified, not provisioned — Xcode, Node, git, and CocoaPods must already be present in the sandbox image.
- Pair it with `rn-deploy preview` for a **baguette + Cloudflare quick-tunnel public URL**: it installs the latest `distribution: "simulator"` build on the sandbox's simulator and exposes it at a live `*.trycloudflare.com` URL (the tunnel keeps running on the sandbox after the command exits).
- Heads-up: cua's **cloud macOS** must be available on your plan — iOS builds and baguette both require a Mac, so the Linux/Windows cloud sandboxes can't run this flow.

`rn-deploy setup` can scaffold both workflows into `.github/workflows/` for you:
- [`rn-deploy.yml`](./templates/github/rn-deploy.yml) — build + publish to R2 (CI).
- [`preview.yml`](./templates/github/preview.yml) — build → R2 → install on a simulator → **baguette + a Cloudflare quick-tunnel public URL** for live manual testing. Run it from the Actions tab; the URL is live while the job is held open (`minutes` input), then the ephemeral runner is destroyed.

Omitting the `host` block entirely is equivalent to `{ "kind": "aws" }`, so existing AWS configs keep working unchanged.

## Credentials

Credentials never live in plaintext. `rn-deploy` delegates to [`asc`](https://github.com/rork/asc), which stores App Store Connect API keys encrypted in the macOS keychain. For each build, the key is uploaded to the remote Mac at `/tmp/AuthKey.p8` (mode `600`), used once, then torn down.

## OTA distribution

If you configure `storage` in `deploy.config.json` (Cloudflare R2 or S3), `rn-deploy build` publishes the build to your bucket and prints links to a self-hosted install page — useful for ad-hoc/internal distribution without TestFlight.

What's published depends on the profile's `distribution`:

- **`ad-hoc` / `development`** — signed `.ipa` + `manifest.plist` + an install page with an `itms-services://` button and a terminal QR code (device install).
- **`simulator`** — an unsigned `iphonesimulator` build, tarred (`<scheme>.app.tgz`) and uploaded. No signing, no ASC key, no provisioning needed. The install page shows a `simctl install` one-liner. Great for sharing a runnable build or driving an automated check.
- **`app-store`** — nothing is published (TestFlight is the install channel).

### Build registry

Every published build also appends a record to a per-app index at `builds/<slug>/index.json` in your bucket (builds are kept forever). That powers two commands:

```bash
rn-deploy builds list           # table of prior builds for this app
rn-deploy builds list --all     # across every app in the bucket

rn-deploy install               # interactive picker → install on the host's simulator
rn-deploy install --latest      # newest build
rn-deploy install --version 1.0.0
rn-deploy install --id 8f3e…    # by build id (prefix ok)
```

For a `simulator` build, `install` downloads the `.app` from the bucket onto the configured host and runs `xcrun simctl install booted` + `launch` (a simulator must be booted — e.g. via the `baguette` streamer). For an `.ipa` build it prints the device install page + QR instead.

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the layout,
how to run each package's tests, and what a good PR looks like. Report security problems
privately, as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Rodrigo Figueroa. Part of [React Native Feel](https://reactnativefeel.com).
