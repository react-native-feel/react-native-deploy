# rn-deploy — Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

`rn-deploy` is a Node.js CLI tool that replaces Expo EAS Build with self-managed AWS EC2 Mac infrastructure. It provisions EC2 Mac instances on demand, builds React Native iOS apps remotely, and submits them to TestFlight using the App Store Connect CLI (`asc`).

## Goals

- Provide a self-hosted alternative to EAS Build for iOS
- Full EC2 Mac lifecycle management (provision, build, teardown)
- EAS-compatible config file with build profiles
- Support both Expo and classic Xcode build workflows
- Automatic code signing via `asc`
- Interactive + non-interactive modes
- Architect for future Android support

## Non-Goals

- Android build support (deferred, but architecture supports it)
- Managed signing certificate storage (relies on App Store Connect API via `asc`)
- Web-based dashboard or build history UI

---

## Command Structure

```
rn-deploy setup                  # First-time setup: configure AWS, ASC credentials
rn-deploy build                  # Build the app on EC2 Mac
rn-deploy build --auto-submit    # Build + submit to TestFlight
rn-deploy submit                 # Submit an existing .ipa to TestFlight
rn-deploy infra up               # Manually spin up EC2 Mac instance
rn-deploy infra down             # Manually tear down EC2 Mac instance
rn-deploy infra status           # Check instance status
rn-deploy infra ami-list         # List custom AMIs
rn-deploy infra ami-delete       # Delete a custom AMI
rn-deploy infra update-ip        # Update security group with current IP
```

### Build Flags

```
--repo <git-url>              Git repo to clone
--branch <name>               Branch to build (default: main)
--profile <name>              Build profile from config (default: production)
--platform ios                Platform (only ios for now)
--build-type <expo|classic>   expo prebuild + xcodebuild vs xcodebuild directly
--scheme <name>               Xcode scheme
--no-teardown                 Keep instance alive after build
--non-interactive             Skip prompts, require all flags
--auto-submit                 Submit to TestFlight after build
--message <text>              Build description
--resume                      Reconnect to in-progress build on existing instance
--timeout <minutes>           Build timeout (default: 60)
```

### Submit Flags

```
--ipa <path>                  Path to .ipa file
--profile <name>              Submit profile from config
--groups <names>              TestFlight groups (comma-separated)
--what-to-test <text>         "What to Test" notes
```

---

## Configuration File

`deploy.config.json` at project root:

```json
{
  "cli": {
    "version": "1.0.0"
  },
  "aws": {
    "region": "us-east-1",
    "instanceType": "mac2.metal",
    "keyPairName": "rn-deploy-key",
    "securityGroupName": "rn-deploy-sg",
    "customAmiId": null,
    "nodeVersion": "20",
    "xcodeVersion": "16"
  },
  "asc": {
    "keyId": "ABC123",
    "issuerId": "DEF456",
    "privateKeyPath": "~/.appstoreconnect/AuthKey.p8"
  },
  "repo": {
    "url": "git@github.com:user/my-app.git",
    "branch": "main"
  },
  "build": {
    "production": {
      "buildType": "expo",
      "scheme": "MyApp",
      "buildConfiguration": "Release",
      "env": {}
    },
    "preview": {
      "extends": "production",
      "distribution": "ad-hoc"
    },
    "development": {
      "extends": "production",
      "buildConfiguration": "Debug"
    }
  },
  "submit": {
    "production": {
      "testFlightGroups": ["Internal Testers"],
      "whatToTest": ""
    }
  }
}
```

### Profile Inheritance

Build profiles support an `extends` field that inherits all settings from the referenced profile. The extending profile's values override the parent. Chain depth limited to 5 levels, no circular references.

---

## Architecture

### End-to-End Flow

```
1. LOAD CONFIG
   ├── Read deploy.config.json
   ├── Merge with CLI flags (flags take precedence)
   └── Prompt for missing required values (if interactive mode)

2. PROVISION INFRASTRUCTURE (via AWS CLI)
   ├── Check .rn-deploy-state.json for existing running instance
   │     If found + reachable → skip to step 3
   ├── Check for existing custom AMI (use it to skip step 3 provisioning)
   ├── Warn user: "24-hour minimum commitment (~$6.50/hr, ~$156 min). Continue?"
   ├── Allocate Dedicated Host (mac2.metal)
   ├── Wait for host "available" (~2-5 min)
   ├── Launch EC2 Mac instance on the host
   ├── Wait for instance "running" + status checks pass (~5-10 min)
   ├── Create/reuse SSH key pair + security group (port 22)
   ├── Save instance ID, host ID, IP, allocation time to .rn-deploy-state.json
   └── Output instance IP + connection info

3. SETUP INSTANCE (via SSH)
   ├── Verify/install Homebrew
   ├── brew install asc
   ├── Install Node.js + CocoaPods
   ├── Upload .p8 key temporarily
   ├── Run asc auth login
   ├── Use asc to fetch + install signing certificate & provisioning profile
   ├── Delete .p8 key from instance
   └── Clone git repo + checkout branch

4. BUILD (via SSH, inside tmux session for resilience)
   ├── npm install / yarn install
   ├── npx pod-install
   ├── If buildType=expo:
   │     npx expo prebuild (generate native Xcode project)
   │   (Both paths then use xcodebuild):
   ├── Generate ExportOptions.plist (method=app-store, teamID, profile)
   ├── xcodebuild archive -workspace ... -scheme ... -archivePath ...
   ├── xcodebuild -exportArchive -archivePath ... -exportOptionsPlist ...
   ├── Stream build logs to terminal in real-time
   ├── Locate .ipa artifact
   ├── Download .ipa to local ./build/ directory via SCP
   └── Build timeout: 60 minutes (configurable), terminates if exceeded

5. SUBMIT TO TESTFLIGHT (if --auto-submit)
   ├── asc builds upload --app <appId> --ipa <path>
   ├── Wait for processing
   ├── asc publish testflight --group <groupName> --wait
   └── Set "What to Test" notes

6. AMI CACHING (after first successful provision)
   ├── Prompt: "Save as custom AMI for faster future builds?"
   ├── If yes: aws ec2 create-image → save AMI ID to config
   └── Future builds use custom AMI, skip step 3

7. TEARDOWN (unless --no-teardown)
   ├── Terminate EC2 instance
   ├── Wait for termination
   ├── Release Dedicated Host
   └── Clean up temporary resources
```

### Code Signing Strategy

Code signing is handled entirely by `asc` on the EC2 instance:

1. CLI uploads the .p8 API key to the instance via SCP
2. Runs `asc auth login` with keyId, issuerId, and the .p8 path
3. `asc` fetches the distribution certificate and provisioning profile from App Store Connect
4. Installs them into the macOS Keychain and provisioning profiles directory
5. The .p8 key is deleted from the instance after auth

No certificates or profiles need to be stored locally or in S3.

---

## Project Structure

```
react-native-deploy/
├── package.json
├── bin/
│   └── rn-deploy.js              # Entry point (#!/usr/bin/env node)
├── src/
│   ├── cli.js                    # Commander setup, command registration
│   ├── config/
│   │   ├── loader.js             # Load + merge deploy.config.json + flags
│   │   ├── profiles.js           # Profile inheritance (extends resolution)
│   │   └── schema.js             # Config validation
│   ├── commands/
│   │   ├── setup.js              # Interactive first-time setup
│   │   ├── build.js              # Build orchestrator
│   │   ├── submit.js             # Submit to TestFlight
│   │   └── infra.js              # infra up/down/status/ami-list/ami-delete
│   ├── infra/
│   │   ├── dedicated-host.js     # Allocate/release Dedicated Host
│   │   ├── instance.js           # Launch/terminate EC2 Mac instance
│   │   ├── security-group.js     # Create/manage SG with SSH access
│   │   ├── key-pair.js           # Create/manage SSH key pair
│   │   └── ami.js                # Create/list/delete custom AMIs
│   ├── remote/
│   │   ├── ssh.js                # SSH connection + command execution
│   │   ├── provision.js          # Install deps on instance
│   │   └── signing.js            # Upload .p8, asc auth, fetch certs
│   ├── build/
│   │   ├── expo.js               # expo prebuild + xcodebuild strategy
│   │   ├── classic.js            # xcodebuild archive/export strategy
│   │   └── artifacts.js          # Locate + retrieve .ipa
│   └── utils/
│       ├── logger.js             # Colored output, spinners, log levels
│       ├── prompts.js            # Interactive prompts wrapper
│       └── aws.js                # AWS CLI exec helper
├── templates/
│   └── deploy.config.json        # Template config for setup command
└── test/
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `inquirer` | Interactive prompts |
| `node-ssh` | SSH connection to EC2 |
| `ora` | Spinners for long-running operations |
| `chalk` | Colored terminal output |

### External Requirements

- **AWS CLI** — installed on the user's machine, authenticated
- **`asc`** — installed on the EC2 instance automatically by the CLI
- **SSH** — available on the user's machine (standard on macOS/Linux)

---

## Interaction Modes

### Interactive (default)

The CLI prompts for any missing values:
- "Enter your git repo URL:"
- "Select build profile: [production/preview/development]"
- "Select build type: [expo/classic]"

### Non-Interactive (--non-interactive)

All required values must come from `deploy.config.json` or CLI flags. Fails fast if anything is missing. Suitable for CI/CD.

### Config File

`deploy.config.json` provides defaults. CLI flags override config values. Interactive prompts fill in remaining gaps.

**Precedence:** CLI flags > config file > interactive prompts

---

## Platform Extensibility

The architecture uses a strategy pattern for builds:
- `build/expo.js` and `build/classic.js` implement a common interface
- Future `build/android.js` can be added without modifying the orchestrator
- Config currently uses flat structure per profile (`build.production.scheme`). When Android is added, platform namespacing (`build.production.ios.scheme`) will be introduced with a config migration

---

## Cost Considerations

EC2 Mac Dedicated Hosts have a **24-hour minimum allocation** (~$6.50/hr, ~$156 minimum). The CLI should:
- Show cost estimate and require confirmation before provisioning
- Suggest using `--no-teardown` to reuse the instance for multiple builds within the 24h window
- Track host allocation time in `.rn-deploy-state.json` so the user knows when teardown is cost-free
- `infra status` displays time remaining on the 24h commitment and running cost

---

## Instance State File

`.rn-deploy-state.json` (gitignored) tracks active infrastructure:

```json
{
  "hostId": "h-0abc123",
  "instanceId": "i-0abc123",
  "publicIp": "54.123.45.67",
  "allocatedAt": "2026-03-12T10:00:00Z",
  "region": "us-east-1",
  "amiId": "ami-base123"
}
```

The `build` command checks this file first. If an instance is running and reachable, it reuses it. If the instance is gone (terminated externally), it cleans up the state file and provisions fresh.

---

## Prerequisite Checks

The `setup` command and the start of `build`/`infra` commands validate:

1. `aws` CLI is on PATH
2. AWS credentials are valid (`aws sts get-caller-identity`)
3. EC2 Mac Dedicated Host quota is available in the target region
4. SSH client is available
5. Git is available (for cloning repos)

Failures produce actionable error messages with fix instructions.

---

## ExportOptions.plist Generation

The CLI generates `ExportOptions.plist` on the EC2 instance before `xcodebuild -exportArchive`. It is derived from config + signing info fetched by `asc`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string> <!-- Dynamic: "ad-hoc" for preview, "app-store" for production -->
    <key>teamID</key>
    <string>TEAM_ID</string>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>manual</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>com.example.myapp</key>
        <string>Profile Name</string>
    </dict>
</dict>
</plist>
```

The `remote/signing.js` module resolves the team ID, bundle ID, and profile name from `asc` and generates this file.

---

## Build Resilience

Builds run inside a `tmux` session on the EC2 instance. This ensures:
- Builds survive SSH disconnects (network issues, laptop sleep)
- `rn-deploy build --resume` reconnects to the tmux session and tails logs
- Build artifacts are preserved on the instance even if the local CLI crashes

---

## Error Handling

- SSH connection failures: retry 3 times with exponential backoff
- Build failures: stream full error log, skip submission, prompt for teardown
- AWS API failures: display error + suggest common fixes (permissions, region, quotas)
- Dedicated Host capacity: if no capacity in region, suggest alternative regions

---

## Security

- .p8 key is uploaded via SCP, used once for `asc auth login`, then deleted
- SSH key pair is generated per-project, private key stored locally
- Security group restricts SSH to user's current IP; `infra update-ip` command available if IP changes mid-build
- No credentials are stored on the EC2 instance after build completes
- `deploy.config.json` is safe to commit (contains only key IDs and paths, not secrets)
- `.rn-deploy-state.json` should be gitignored (contains instance IDs, IPs)
- The `.p8` private key file itself should never be committed
