# How it works

There is no server in the middle. The CLI talks to two things: the GitHub API, to run and read
builds, and `asc`, to talk to App Store Connect.

```
eas build  ──►  resolve the eas.json profile       (a port of @expo/eas-json)
           ──►  translate it into a build plan      (distribution → export method, …)
           ──►  workflow_dispatch                   (.github/workflows/eas-build.yml)
           ──►  poll the run; download the artifact

eas submit ──►  resolve the submit profile
           ──►  asc builds upload                   ──►  App Store Connect
           ──►  asc builds add-groups               ──►  TestFlight
```

## A build is a workflow run

`eas build` dispatches `eas-build.yml` with the resolved plan as its input. The run *is* the
build: its status, step timings, logs and artifacts are what `eas build:list`, `eas build:view`
and the dashboard show.

To find its own run again, the CLI stamps a random **dispatch id** into the run name, together
with the platform, profile, distribution and whether it is a simulator build:

```
ios preview build [eas:dispatch_id=1b0f302e-…;platform=ios;profile=preview;distribution=internal;simulator=false]
```

GitHub does not return dispatch inputs on a run, so this run name is how the platform, profile
and distribution survive.

**Build ids** are a SHA-256 of `owner/repo#runId`, formatted as a v4-shaped UUID. They are stable,
need nothing stored, and come out the same in Node and in the browser. Anywhere a build id is
accepted, a unique prefix or the raw run id works too.

## What the runner does

| Step | iOS (`macos-26`) | Android (`ubuntu-latest`) |
|---|---|---|
| Plan | unpack the build plan into step outputs | same |
| Environment | export the profile's `env` **before** the app config is read | same |
| Install | Node and your package manager; install from your lockfile | same, plus JDK 17 and the Android SDK |
| Prebuild | `expo prebuild` unless `ios/` / `android/` are committed | same |
| Native deps | `pod install`, with a Pods cache | — |
| Sign | import the p12 into a throwaway keychain; apply the profile to the app target | inject a keystore through Gradle properties, if present |
| Build | `xcodebuild archive` + export, or a simulator build | the Gradle task for the profile |
| Publish | internal builds → the install service | same |
| Upload | `application-archive` artifact (90 days), plus Xcode logs | `application-archive` artifact |

The full list, and the secrets and variables each step reads, is in the
[workflow reference](/reference/workflow).

Failures are failures: if `xcodebuild` exits non-zero, or a simulator build produces no usable
`.app`, the step fails and points you at the `xcode-logs` artifact. A build is never reported
green with an empty artifact.

## The dashboard shares the CLI's code

The [dashboard](/guide/dashboard) imports the same module the CLI uses to turn a workflow run into
an EAS build record. `eas build:list --json` and the dashboard cannot disagree about a build's
status, duration or artifact.

## Cost

Runner minutes come out of your GitHub account.

| Repository | macOS (iOS builds) | Linux (Android builds) |
|---|---|---|
| Public | free | free |
| Private | 10× multiplier: a Free plan's 2,000 min/month is about 200 macOS minutes | 1× |

A typical React Native iOS archive takes 6–15 minutes and Android 4–8. `resourceClass: "large"`
maps to `macos-26-xlarge`, which is never covered by included minutes and bills per minute on
every plan; the CLI warns before dispatching one.

::: tip Public repositories and artifacts
On a public repository, workflow artifacts (your `.ipa` and `.apk`) can be downloaded by any
signed-in GitHub user for their 90-day retention. Repository secrets stay private.
:::
