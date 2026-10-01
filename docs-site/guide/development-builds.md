# Development builds

A development build is your app with [`expo-dev-client`](https://docs.expo.dev/develop/development-builds/introduction/)
compiled in. It contains no JavaScript of its own: it loads your code from Metro on your machine,
so edits appear on the device in a second or two with Fast Refresh. You rebuild only when native
code or config changes.

| | Development build | Preview / internal build |
|---|---|---|
| JavaScript | Loaded live from Metro | Bundled into the app at build time |
| Hot reload | Yes | No: every change needs a new build and reinstall |
| Build configuration | `Debug` / `assembleDebug` | `Release` / `assembleRelease` |
| For | You, while coding | Testers |

## Setup

```sh
npx expo install expo-dev-client
```

Then two profiles: one for the iOS Simulator, one for real devices.

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "development-device": {
      "developmentClient": true,
      "distribution": "internal"
    }
  }
}
```

On Android the two are the same: a debug `.apk` runs on emulators and devices alike.

## In the iOS Simulator

No signing needed.

```sh
eas build -p ios -e development
eas build:download -p ios
cd build && unzip *.zip && tar -xzf *-simulator.tar.gz
xcrun simctl install booted *.app

npx expo start --dev-client     # press i, or open the app and pick the server
```

## On your phone

A device build is signed with your **ad-hoc profile**, so it installs only on the devices that
profile lists. Set that up once in [Internal distribution](/guide/internal-distribution).

```sh
eas build -p all -e development-device
```

When the build finishes, open its **Install** QR in the [dashboard](/guide/dashboard), scan it
with the phone and install. Then start Metro so the phone can reach it over your network:

```sh
npx expo start --dev-client --lan
```

Open the app on the phone. Its launcher lists development servers it finds on your network; tap
yours. You can also scan the QR code `expo start` prints in an interactive terminal, or encode
this URL yourself:

```
exp+<slug>://expo-development-client/?url=http%3A%2F%2F<your-computer-ip>%3A8081
```

::: tip The phone must reach your computer
- Same Wi-Fi network, and no client isolation on it.
- The first launch asks for **Local Network** access: allow it, or the app cannot find Metro.
- On iOS 16 or later, **Developer Mode** must be on (Settings → Privacy & Security).
- Different networks? `npx expo start --dev-client --tunnel` relays through a public URL.
:::

::: warning Same app, same slot
Development, preview and production builds share a bundle identifier, so installing one replaces
the other on the phone.
:::
