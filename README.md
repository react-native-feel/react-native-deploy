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
| `rn-deploy credentials *`     | Manage App Store Connect API keys (via `asc` keychain) |
| `rn-deploy infra up\|down\|status` | Provision / tear down EC2 Mac infrastructure       |

Run `rn-deploy <command> --help` for full flags.

## Configuration

`rn-deploy` reads `deploy.config.json` from your project root. It follows EAS-style profile inheritance — `preview` and `development` `extends: "production"` by default. See `templates/deploy.config.json` for the full shape.

## Credentials

Credentials never live in plaintext. `rn-deploy` delegates to [`asc`](https://github.com/rork/asc), which stores App Store Connect API keys encrypted in the macOS keychain. For each build, the key is uploaded to the remote Mac at `/tmp/AuthKey.p8` (mode `600`), used once, then torn down.

## OTA distribution

If you configure `storage` in `deploy.config.json` (Cloudflare R2 or S3), `rn-deploy build` will publish the signed `.ipa` to your bucket and print a QR code pointing at a self-hosted install page — useful for ad-hoc/internal distribution without TestFlight.

## License

[MIT](./LICENSE) © Rodrigo Figueroa
