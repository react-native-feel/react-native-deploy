# Getting started

This takes an Expo or React Native app from a local folder to a first cloud build. Signing and
store delivery come later, in [Credentials](/guide/credentials) and
[Submitting to TestFlight](/guide/submit).

## Prerequisites

- **Node.js 20** or later.
- **A GitHub repository** for the app. Public repositories get macOS runner minutes for free;
  private ones bill macOS at 10× against your included minutes ([cost](/guide/how-it-works#cost)).
- **A GitHub token** with the `repo` and `workflow` scopes. If you use the GitHub CLI,
  `gh auth token` already has them.
- **[`asc`](https://github.com/rork/asc)**, only for anything that talks to App Store Connect:
  submitting, devices, signing assets.

## 1. Install the CLI

```sh
cd eas
npm install
npm link        # puts `eas` on your PATH
```

::: warning If you also have Expo's eas-cli installed
Both packages install a binary called `eas`, and whichever was linked last wins. Check with
`readlink -f "$(which eas)"`. To keep both, call this one by path, for example
`alias rneas="node /path/to/eas/bin/eas.js"`.
:::

## 2. Log in

Logging in stores a GitHub token, because GitHub is what runs the builds.

```sh
EAS_GITHUB_TOKEN=$(gh auth token) eas login
eas whoami
```

The token is written to `~/.eas-gh/auth.json` with mode `0600`. Without `EAS_GITHUB_TOKEN`,
`eas login` prompts for it without echoing.

## 3. Configure the project

```sh
cd ~/code/my-app
eas build:configure
```

This writes `eas.json` (if you don't have one) and `.github/workflows/eas-build.yml`. If you
already use EAS, keep your `eas.json`: it is the input, and nothing rewrites it.

Then make sure `app.json` names the app on each platform. `build:configure` does not add these,
and a managed project is prebuilt on the runner, which needs them:

```json
{
  "expo": {
    "ios": { "bundleIdentifier": "com.example.myapp" },
    "android": { "package": "com.example.myapp" }
  }
}
```

## 4. Push the workflow

GitHub can only dispatch a workflow that exists on the branch you build.

```sh
git add eas.json app.json .github
git commit -m "Add rn-eas build workflow"
git push
```

::: warning Brand-new repository?
GitHub does not register a dispatch-only workflow that arrives in the push that **creates** the
repository, and the first `eas build` then fails with `(404): Not Found`. Change any line of
`.github/workflows/eas-build.yml` and push again. See [Troubleshooting](/guide/troubleshooting#first-build-404).
:::

## 5. Build

A simulator build needs no signing, so it is the quickest first build. Add a profile with
`ios.simulator`:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    }
  }
}
```

Then:

```sh
npx expo install expo-dev-client   # the development profile builds a dev client
eas build --platform all --profile development
```

`eas build` prints the run URL and, by default, waits for the build to finish. With `--no-wait`
it returns immediately; follow along with `eas build:list` or the [dashboard](/guide/dashboard).

## 6. Download and run it

```sh
eas build:download --platform ios
cd build && unzip *.zip && tar -xzf *-simulator.tar.gz
xcrun simctl install booted *.app
npx expo start --dev-client
```

Android development builds are a debug `.apk` you can drag onto an emulator or install with
`adb install`.

## Next steps

- [Install builds on real devices with a QR code](/guide/internal-distribution)
- [Set up signing](/guide/credentials) and [ship to TestFlight](/guide/submit)
- [What happens on the runner](/guide/how-it-works)
