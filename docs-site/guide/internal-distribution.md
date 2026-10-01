# Internal distribution (QR install)

An **internal** build (`distribution: "internal"`) is meant for your own and your testers'
devices. rn-eas publishes it to an **install service**, a small Cloudflare Worker you deploy
once. The dashboard's **Install** button shows a QR code; a tester scans it and gets an install
page:

- **iPhone / iPad:** an **Install** button: Apple's over-the-air install (`itms-services`).
- **Android:** a **Download APK** button.
- **A computer:** the link to open on the device, and on Android a direct download.

```
eas build -e preview ─► runner signs with your ad-hoc profile
                     ─► uploads app.ipa / app.apk and meta.json to the install service (R2)
dashboard → Install  ─► QR → https://<worker>/install/<dispatch-id>
phone                ─► Install → manifest.plist → app.ipa
```

Install links are keyed by the build's random dispatch id, so they cannot be guessed from a run
number. They are not authenticated: anyone with the link can download that build.

## One-time setup

### 1. Deploy the install service

See [Dashboard & install service](/guide/dashboard#deploy). You end up with a URL such as
`https://rn-eas-deploy.<you>.workers.dev` and an upload token.

### 2. Point the repository at it

```sh
gh variable set EAS_INSTALL_URL --body "https://rn-eas-deploy.<you>.workers.dev"
gh secret set EAS_INSTALL_TOKEN < upload_token     # the Worker's UPLOAD_TOKEN, from a file
```

`EAS_INSTALL_URL` is a variable rather than a secret because it isn't sensitive. Without it,
internal builds stay GitHub artifacts only.

### 3. Create an ad-hoc profile for your devices (iOS)

iOS installs an internal build only on devices listed in its **ad-hoc provisioning profile**.
That profile lives in its own secret, because an App Store profile cannot sign an ad-hoc export.

```sh
eas device:list                    # name, model and UDID of each registered device
asc profiles create \
  --bundle <bundle-id-resource-id> \
  --certificate <distribution-certificate-id> \
  --device <device-id>[,<device-id>…] \
  --profile-type IOS_APP_ADHOC \
  --name "MyApp AdHoc" --output json \
  | python3 -c 'import json,sys,base64; d=json.load(sys.stdin)["data"]; open("adhoc.mobileprovision","wb").write(base64.b64decode(d["attributes"]["profileContent"]))'

base64 -i adhoc.mobileprovision | gh secret set EAS_IOS_PROFILE_INTERNAL
eas credentials -p ios             # ✔ EAS_IOS_PROFILE_INTERNAL
```

Use the same distribution certificate as your store builds ([Credentials](/guide/credentials)).

::: danger Check the model, not just the name
Two devices can share a name. If the profile holds a different phone from the one you install
on, iOS refuses with only *"This app cannot be installed because its integrity could not be
verified."* `eas device:list` shows the model next to each name. The phone's own UDID is under
Finder → the device → click the serial number, or `xcrun devicectl device info details --device <id>`.
:::

## Building and installing

```sh
eas build -p all -e preview
```

The build's log and its GitHub run summary end with **📲 Install this build** and the link. In
the dashboard, open the build and press **Install** for the QR. On the phone:

1. Scan the QR with the Camera app and tap the banner.
2. Tap **Install**, then **Install** again in the prompt.
3. iOS 16 or later: turn on **Settings → Privacy & Security → Developer Mode** the first time.

Installing a newer build of the same app replaces the old one in place.

## Adding a device

A device added after a build was signed cannot install that build.

1. Register it: `asc devices create --name "Ana's iPhone" --udid <UDID> --platform IOS`.
2. Regenerate the ad-hoc profile with the new device included, and update
   `EAS_IOS_PROFILE_INTERNAL`.
3. Rebuild.

## Android

Android needs no device list. Until you add a [release keystore](/guide/credentials#android),
release builds are signed with the debug key: fine for sideloading, not for Google Play.
