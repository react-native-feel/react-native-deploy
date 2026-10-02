# eas.json support

`eas.json` is the input. React Native Deploy parses and validates every field in EAS's build and submit
schemas, using a port of `@expo/eas-json` that a differential test suite holds against the real
package.

## What is supported

- **JSON5.** Comments and trailing commas are fine. If an `eas.json` exists,
  `rnd build:configure` leaves it untouched, comments included.
- **`extends`** chains, up to five deep. `env` and the platform blocks are merged, not replaced.
- **Platform overrides.** A top-level field with an `ios` or `android` block that overrides it
  resolves exactly as EAS resolves it.
- **`$VAR` indirection** in `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId` and
  `serviceAccountKeyPath` — those four fields, as in EAS.
- **Schema defaults**: `credentialsSource: "remote"`, `distribution: "store"`,
  `track: "internal"`, `language: "en-US"`, and the rest.
- **Deprecation warnings** match EAS's.

## A typical eas.json

```json5
{
  "cli": { "version": ">= 5.2.0", "appVersionSource": "local" },
  "build": {
    // Dev client in the iOS Simulator; JavaScript from Metro on your machine.
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    // Dev client on registered devices, installed from a QR code.
    "development-device": {
      "developmentClient": true,
      "distribution": "internal"
    },
    // A release build for testers, installed from a QR code.
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {
      "ios": { "ascAppId": "6817907751", "groups": ["QA"] }
    }
  }
}
```

## Seeing what a profile resolves to

```sh
rnd config --platform ios --profile preview
rnd config -p android -e production --json
```

The effective profile is often not what the file looks like, once `extends`, platform blocks and
defaults are applied. This prints both the build profile and the matching submit profile.

## Fields the runner acts on

| Field | Effect |
|---|---|
| `distribution`, `ios.simulator`, `ios.enterpriseProvisioning` | Export method and artifact type ([table](/guide/building#which-artifact-you-get)) |
| `developmentClient` | `Debug` / `assembleDebug` by default |
| `ios.buildConfiguration`, `ios.scheme` | Override the Xcode configuration and scheme. Without `scheme`, the runner uses the workspace prebuild generated |
| `android.buildType`, `android.gradleCommand` | Gradle task |
| `env` | Exported before the app config is read |
| `node`, `bun`, `pnpm`, `yarn`, `corepack` | Toolchain on the runner |
| `resourceClass` | Runner size ([table](/guide/building#runners)) |
| `cache.key`, `cache.disabled` | CocoaPods cache |
| `prebuildCommand` | Replaces `expo prebuild` |
| `withoutCredentials` | Skips iOS signing |

Fields that only make sense on Expo's servers (`channel`, `runtimeVersion`, …) are parsed and
validated but have no effect on the runner.
