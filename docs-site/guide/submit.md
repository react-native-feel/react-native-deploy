# Submitting to TestFlight

`eas submit` uploads an `.ipa` to App Store Connect with [`asc`](https://github.com/rork/asc),
waits for Apple to process it, and adds it to TestFlight groups.

## Before the first submission

1. **An App Store Connect API key in `asc`:** `asc auth login`. `eas submit` uses `asc`'s default
   key unless the submit profile names one (below).
2. **An app record.** Apple has no API for creating apps: create it once at
   [App Store Connect → Apps → +](https://appstoreconnect.apple.com/apps) with your bundle id.
   Note its numeric **Apple ID**.
3. **A signed store build:** `distribution: "store"` with [credentials](/guide/credentials) set up.
4. **Optional:** a TestFlight group to send it to.
   `asc testflight groups create --app <apple-id> --name "QA" --internal`

## The submit profile

```json
{
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "6817907751",
        "groups": ["QA"]
      }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `ascAppId` | The app's Apple ID. Without it, the app is found by `ios.bundleIdentifier` |
| `groups` | TestFlight groups to add the build to. `--groups` on the command line replaces this list |
| `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId` | Use a specific API key instead of `asc`'s default; `$VAR` references are expanded |
| `language` | Locale for the "What to Test" note (default `en-US`) |

## Submitting

```sh
eas build -p ios -e production
eas build:download -p ios
cd build && unzip *.zip && cd ..
eas submit -p ios --profile production --path build/MyApp.ipa \
  --what-to-test "Checkout flow rewrite"
```

What happens:

1. `asc builds upload` sends the `.ipa`.
2. When `groups` are set, it waits for processing: Apple has to know the build before it can be
   added to a group. This usually takes a few minutes.
3. The build is added to each group, and the TestFlight link is printed.

`eas submit` without `--path` finds your latest store build and tells you the two commands to
download it: `asc` uploads local files only.

```sh
eas submit:status -p ios        # live App Store version and recent TestFlight builds
```

## Getting it onto a phone

Internal testers must be users of your App Store Connect team and members of the group. Add
yourself under **TestFlight → (group) → Testers**, then install from the TestFlight app.

::: warning Build numbers
App Store Connect rejects an upload whose build number it has already seen for that version.
`autoIncrement` is not applied yet, so bump `ios.buildNumber` in `app.json` before each store
build.
:::

## Android

Not wired up yet: Google Play needs a service account rather than `asc`. The `.aab` from a store
build uploads to Play Console unchanged.
