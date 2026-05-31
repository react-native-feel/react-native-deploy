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

The `host` block picks where builds run. Three kinds are supported:

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

## License

[MIT](./LICENSE) © Rodrigo Figueroa
