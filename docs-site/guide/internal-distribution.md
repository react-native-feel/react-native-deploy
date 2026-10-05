# Internal distribution (QR install)

An **internal** build (`distribution: "internal"`) is meant for your own and your testers'
devices. React Native Deploy publishes it to an **install service**, a small Cloudflare Worker you deploy
once. The dashboard's **Install** button shows a QR code; a tester scans it and gets an install
page:

- **iPhone / iPad:** an **Install** button: Apple's over-the-air install (`itms-services`).
- **Android:** a **Download APK** button.
- **A computer:** the link to open on the device, and on Android a direct download.

```
rnd device:create    ─► QR → https://<worker>/register-device/<token>
tester's iPhone      ─► installs a one-shot profile → iOS posts its UDID → registry (D1), "pending"
rnd build -e preview ─► runner registers pending devices with Apple, regenerates the ad-hoc profile,
                        signs with it
                     ─► uploads app.ipa / app.apk and meta.json to the install service (R2)
dashboard → Install  ─► QR → https://<worker>/install/<dispatch-id>
phone                ─► Install → manifest.plist → app.ipa
```

Install links are keyed by the build's random dispatch id, so they cannot be guessed from a run
number. They are not authenticated: anyone with the link can download that build.

## One-time setup

### 1. Deploy the install service

See [Dashboard & install service](/guide/dashboard#deploy). You end up with a URL such as
`https://<name>.pages.dev` and an upload token.

### 2. Point the repository at it

```sh
gh variable set EAS_INSTALL_URL --body "https://<name>.pages.dev"
gh secret set EAS_INSTALL_TOKEN < upload_token     # the Worker's UPLOAD_TOKEN, from a file
```

`EAS_INSTALL_URL` is a variable rather than a secret because it isn't sensitive. Without it,
internal builds stay GitHub artifacts only.

### 3. Let the build generate the ad-hoc profile (iOS)

iOS installs an internal build only on devices listed in its **ad-hoc provisioning profile**.
Give the workflow an [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api)
(role **Admin** or **App Manager**, which can register devices and manage profiles) and it
keeps that profile up to date by itself, the way EAS does:

```sh
gh secret set EAS_ASC_KEY_ID --body "ABC123DEFG"
gh secret set EAS_ASC_ISSUER_ID --body "69a6de7e-…"
gh secret set EAS_ASC_API_KEY < AuthKey_ABC123DEFG.p8
rnd credentials -p ios             # ✔ EAS_ASC_KEY_ID, EAS_ASC_ISSUER_ID, EAS_ASC_API_KEY
```

On every internal iOS build, before signing, the **Provision ad-hoc profile** step:

1. Reads the [device registry](#registering-devices) and registers each `pending` device with
   Apple (or re-enables it, if Apple has it disabled), then marks it `registered`.
2. Compares the devices with the profile it generated last time, named `rnd ad-hoc <bundle id>`.
   If the devices and certificate are unchanged, it reuses the profile. Otherwise it deletes the
   old profile and creates a new one, because the API can't edit a profile's device list.
3. Signs with that profile and lists its devices in the log:

```
Registered Ana's iPhone (00008140-000024A414C1801C) with Apple.
Generated ad-hoc profile "rnd ad-hoc com.example.myapp" for 3 device(s).
  • Ana's iPhone  00008140-000024A414C1801C
  • …
```

A device Apple refuses (invalid UDID, yearly device limit reached) produces a warning and is left
out; the build continues. Without a device registry, the profile lists every enabled iOS device
on the Apple team.

::: details Without an API key: a profile you make yourself
Put an ad-hoc profile in the `EAS_IOS_PROFILE_INTERNAL` secret instead. It is used as is, so
after adding a device you regenerate it by hand:

```sh
asc profiles create \
  --bundle <bundle-id-resource-id> \
  --certificate <distribution-certificate-id> \
  --device <device-id>[,<device-id>…] \
  --profile-type IOS_APP_ADHOC \
  --name "MyApp AdHoc" --output json \
  | python3 -c 'import json,sys,base64; d=json.load(sys.stdin)["data"]; open("adhoc.mobileprovision","wb").write(base64.b64decode(d["attributes"]["profileContent"]))'

base64 -i adhoc.mobileprovision | gh secret set EAS_IOS_PROFILE_INTERNAL
```

Use the same distribution certificate as your store builds ([Credentials](/guide/credentials)).
:::

## Registering devices

The install service keeps a **device registry** (a Cloudflare D1 database): the list of devices
the next ad-hoc profile is generated from. It's the equivalent of the devices EAS stores on Expo's
servers. Set it up once with the D1 steps in [Dashboard & install service](/guide/dashboard#deploy).

```sh
rnd device:create
```

```
How would you like to register your devices?
  1. Website: a link or QR code to open on the device (recommended)
  2. An iPhone or iPad connected to this Mac
  3. This Mac (Apple silicon)
  4. Enter a UDID
  5. Import the devices already on your Apple Developer account
```

**Website** prints a QR code and a link. Send it to your testers; it works for any number of
devices for 30 days. On the iPhone or iPad:

1. Open the link in Safari and tap **Download profile**, then **Allow**.
2. Open **Settings**, tap **Profile Downloaded** near the top, then **Install**.
3. Safari comes back with **✓ Device registered**, showing the device's name, model and UDID.

This is Apple's over-the-air enrollment (a "Profile Service" payload): the profile only asks iOS
for the UDID, model, OS version and device name, and nothing stays installed afterwards. iOS labels
the profile **Not Verified** because it is unsigned. That label is cosmetic.

**Connected device** reads the UDID with `xcrun devicectl` and suggests a name with the model,
for example "Iphone roro (iPhone 16)". **Import** adds what Apple already has, which is the way to
move an existing hand-made profile's devices over.

The CLI finds the registry through `EAS_INSTALL_URL` (the environment, then the repository
variable). The first time, it asks for the install token (the `UPLOAD_TOKEN` value) and stores
it in `~/.eas-gh/install.json`. Set `EAS_INSTALL_TOKEN` to skip the prompt, for example in CI.

```sh
rnd device:list
```

```
  Ana's iPhone                 iPhone17,3     00008140-000024A414C1801C                pending
  Iphone roro (iPhone 11)      iPhone12,1     00008030-0001592C1ABB802E                registered
```

`pending` devices get registered with Apple by the next internal build. Also:
`rnd device:view <UDID>`, `rnd device:rename`, and `rnd device:delete`. Deleting removes the device
from the next profile; Apple keeps it, and it counts toward the yearly limit until your
membership renews.

::: danger Check the model, not just the name
Two devices can share a name. If the profile holds a different phone from the one you install
on, iOS refuses with only *"This app cannot be installed because its integrity could not be
verified."* That is why `rnd device:list` shows the model, and why the install page lists the
devices a build was signed for.
:::

## Building and installing

```sh
rnd build -p all -e preview
```

The build's log and its GitHub run summary end with **📲 Install this build** and the link. In
the dashboard, open the build and press **Install** for the QR. On the phone:

1. Scan the QR with the Camera app and tap the banner.
2. Tap **Install**, then **Install** again in the prompt.
3. iOS 16 or later: turn on **Settings → Privacy & Security → Developer Mode** the first time.

Installing a newer build of the same app replaces the old one in place.

An iOS install page lists the devices the build installs on, under **Installs on N devices**.
A phone registered through a QR link is recognised (by a cookie set on the **Device registered**
page): it is marked *(this device)*, or, if the build doesn't include it, a warning says so before
anyone taps **Install**.

## Adding a device

A device added after a build was signed cannot install that build. With the API key set up:

1. `rnd device:create`, and register the device.
2. Rebuild. The profile is regenerated with the new device.

Apple can take a while to process a new device. If the build warns that a device *"is not in the
profile yet"*, build again later.

## Android

Android needs no device list. Until you add a [release keystore](/guide/credentials#android),
release builds are signed with the debug key: fine for sideloading, not for Google Play.
