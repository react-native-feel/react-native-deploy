# react-native-deploy

Three independent command-line tools for shipping a React Native app without owning a Mac. They cover different parts of the workflow and share no code — pick the one that matches what you're trying to do.

| | **`rn-build`** ([`gh-build/`](gh-build/README.md)) | **`rn-deploy`** (this directory) | **`rn-preview`** ([`sim-preview/`](sim-preview/README.md)) |
|---|---|---|---|
| Question it answers | "Build this, iOS and Android, on someone else's Mac." | "Ship this build to testers." | "What does this look like right now?" |
| Mac it uses | GitHub-hosted `macos-15` runner, per build | AWS EC2 `mac2.metal` on a Dedicated Host, provisioned and torn down per build | A long-lived remote Mac you already rent (MacinCloud), reached over SSH |
| Auth | GitHub PAT (`repo` + `workflow`) | SSH key, `ec2-user` | SSH password, your MacinCloud user |
| Config | `rn-build.config.json` (committable, no secrets) | `deploy.config.json` (build/submit profiles) | `sim-preview/.env` (`RN_PREVIEW_*`) |
| Produces | a signed `.ipa` **and** `.apk`/`.aab` in `./build` | a signed `.ipa` on App Store Connect / TestFlight | a booted iOS Simulator streamed to your browser |
| Cost model | your GitHub Actions minutes (free on public repos; 10× multiplier for macOS on private) | pay per build, host released afterwards | flat monthly rental, always up |
| Entry point | `rn-build setup` / `build` | `rn-deploy build` / `submit` / `infra` | `sim-preview/bin/baguette.sh` + `tunnel.sh` |

`rn-build` is the EAS Build replacement: same job as `eas build`, but the compute
is billed to your own GitHub account and the signing assets stay in your repo's
secrets. It is the only one of the three that also builds Android.

### They are not a pipeline

Nothing hands off between them today. Both build tools archive with
`-destination "generic/platform=iOS"` and manual signing, so they only ever
produce a **device** `.ipa`. Installing into `rn-preview`'s simulator would need
an unsigned `.app` built for `generic/platform=iOS Simulator`. Wiring that seam
(a `simulator` build profile plus a `simctl install` step) is the change that
would turn these tools into one loop; until then, treat them as separate.

`rn-build` also stops at the artifact — TestFlight submission still lives in
`rn-deploy submit`, which expects an EC2 Mac.

Each tool owns its own `logger.js` and state file, and the two SSH-based tools
each own their own `ssh.js`. That duplication is deliberate — see
`sim-preview/docs/superpowers/specs/2026-03-23-simulator-streaming-design.md` —
because they target very different machines with different auth.

---

# rn-deploy

Build React Native iOS apps on AWS EC2 Mac instances and deploy to TestFlight — from the command line.

## Why

Building iOS apps requires macOS and Xcode. If you don't have a Mac build server, `rn-deploy` spins up an EC2 Mac instance on AWS, runs the build remotely, and submits the resulting `.ipa` to TestFlight. When the build is done, the infrastructure is torn down so you only pay for what you use.

## Prerequisites

- **Node.js** >= 18
- **AWS CLI** configured with credentials that can manage EC2 Dedicated Hosts, instances, security groups, and AMIs
- **App Store Connect API key** (`.p8` file) for TestFlight submission
- **Xcode** available on the remote AMI (provisioned automatically)

## Install

```bash
npm install -g rn-deploy
```

## Quick Start

```bash
# 1. Interactive setup — generates deploy.config.json
rn-deploy setup

# 2. Build your app on a remote EC2 Mac
rn-deploy build --repo git@github.com:you/your-app.git

# 3. Submit the .ipa to TestFlight
rn-deploy submit --ipa ./build/YourApp.ipa
```

## Commands

### `rn-deploy setup`

Interactive wizard that creates a `deploy.config.json` in the current directory.

### `rn-deploy build`

Provisions infrastructure (if needed), clones your repo on the remote Mac, builds the iOS app, and downloads the `.ipa`.

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <url>` | Git repository URL | from config |
| `--branch <name>` | Branch to build | `main` |
| `--profile <name>` | Build profile from config | `production` |
| `--build-type <type>` | `expo` or `classic` | from config |
| `--scheme <name>` | Xcode scheme | from config |
| `--no-teardown` | Keep instance alive after build | `false` |
| `--auto-submit` | Submit to TestFlight after build | `false` |
| `--message <text>` | Build description | — |
| `--resume` | Reconnect to an in-progress build | — |
| `--timeout <minutes>` | Build timeout | `60` |
| `--non-interactive` | Skip prompts, require all flags | `false` |

### `rn-deploy submit`

Uploads an `.ipa` to App Store Connect and distributes it to TestFlight groups.

| Flag | Description | Default |
|------|-------------|---------|
| `--ipa <path>` | Path to `.ipa` file | — |
| `--profile <name>` | Submit profile from config | `production` |
| `--groups <names>` | TestFlight groups (comma-separated) | from config |
| `--what-to-test <text>` | "What to Test" notes | from config |

### `rn-deploy infra`

Manage the underlying AWS infrastructure directly.

| Subcommand | Description |
|------------|-------------|
| `infra up` | Provision a Dedicated Host and launch an EC2 Mac instance |
| `infra down` | Terminate the instance and release the Dedicated Host |
| `infra status` | Show current infrastructure status and running cost |
| `infra ami-list` | List custom AMIs |
| `infra ami-delete` | Delete a custom AMI |
| `infra update-ip` | Update the security group with your current public IP |

## Configuration

`rn-deploy setup` generates a `deploy.config.json` file. Key sections:

```jsonc
{
  "aws": {
    "region": "us-east-1",
    "instanceType": "mac2.metal",
    "nodeVersion": "20",
    "xcodeVersion": "16"
  },
  "asc": {
    "keyId": "",
    "issuerId": "",
    "privateKeyPath": "~/.appstoreconnect/AuthKey.p8"
  },
  "build": {
    "production": {
      "buildType": "expo",
      "scheme": "MyApp",
      "buildConfiguration": "Release"
    },
    "preview": { "extends": "production", "distribution": "ad-hoc" },
    "development": { "extends": "production", "buildConfiguration": "Debug" }
  },
  "submit": {
    "production": {
      "testFlightGroups": ["Internal Testers"]
    }
  }
}
```

Build profiles support inheritance via `extends`, so you only override what changes per environment.

## How It Works

1. **Infra** — Allocates an EC2 Mac Dedicated Host, launches an instance, configures SSH access via a security group scoped to your IP.
2. **Provision** — Installs Homebrew, Node.js, CocoaPods, and Xcode on the remote instance (or uses a pre-baked custom AMI).
3. **Build** — Clones your repo, installs dependencies, runs `expo prebuild` (Expo) or builds directly with `xcodebuild` (classic), and code-signs the output.
4. **Artifact** — Downloads the `.ipa` to your local machine.
5. **Submit** — Authenticates with App Store Connect and uploads to TestFlight.
6. **Teardown** — Terminates the instance and releases the Dedicated Host to stop billing.

## License

ISC
