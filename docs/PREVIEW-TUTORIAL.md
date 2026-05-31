# Manual tutorial: Expo app → MacinCloud build → R2 → baguette preview URL

Run an unsigned **simulator** build of an Expo app on a MacinCloud Mac, publish
the `.app` to Cloudflare R2, then view it live in a browser through baguette +
a Cloudflare tunnel. No App Store credentials needed.

Everything runs from your laptop; the actual compile happens on the Mac.

---

## 0. Prerequisites (your laptop)

- Node ≥ 18, `git`, and this repo cloned. Set a shortcut:
  ```bash
  RND=/path/to/react-native-deploy   # this repo
  ```
- A MacinCloud Mac you can SSH into (host / user / password).
- Cloudflare R2: a bucket with **public access enabled**, plus an S3
  access key + secret and your account id.
- A GitHub repo the Mac can clone (public is simplest).

---

## 1. Create (or use) an Expo app

```bash
npx create-expo-app@latest myapp --template blank
cd myapp
```

Set an iOS bundle id in `app.json` (any reverse-DNS string is fine for simulator):

```jsonc
{
  "expo": {
    "name": "myapp",
    "ios": { "bundleIdentifier": "com.you.myapp" }
  }
}
```

Your **scheme** is the app `name` with non-alphanumerics removed (e.g. `My App` → `MyApp`). Here it's `myapp`.

---

## 2. Push the app to GitHub

The Mac clones this repo to get the source.

```bash
git init && git add -A && git commit -m "app"
gh repo create you/myapp --public --source=. --push
```

---

## 3. Add `deploy.config.json` (in the app dir)

This is read on your laptop — the Mac never sees it. Keep it gitignored
(`echo deploy.config.json >> .gitignore`) since it has your R2 account id.

```jsonc
{
  "cli": { "version": "1.0.0" },

  "host": {
    "kind": "macincloud",
    "host": "${MAC_HOST}",
    "user": "${MAC_USER}",
    "password": "${MAC_PASSWORD}",
    "port": 22,
    "workDir": "~/rn-deploy-work"
  },

  "storage": {
    "kind": "r2",
    "accountId": "<your-cloudflare-account-id>",
    "bucket": "react-native-deploy",
    "publicBaseUrl": "https://pub-XXXXXXXX.r2.dev"
  },

  "repo": { "url": "https://github.com/you/myapp.git", "branch": "main" },

  "build": {
    "preview": {
      "buildType": "expo",
      "scheme": "myapp",
      "buildConfiguration": "Release",
      "distribution": "simulator",
      "env": {}
    }
  }
}
```

- `${MAC_*}` are read from the environment at load time (secrets stay out of the file).
- R2 keys are read from env (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`); `accountId`, `bucket`, `publicBaseUrl` come from this file.

---

## 4. Export credentials

```bash
# MacinCloud SSH
export MAC_HOST=TX0XX.macincloud.com
export MAC_USER=userXXXXXX
export MAC_PASSWORD='your-mac-password'

# Cloudflare R2 (account-level S3 keys)
export R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export R2_ACCESS_KEY_ID=xxxxxxxx
export R2_SECRET_ACCESS_KEY=xxxxxxxx
```

(Shortcut for this machine: `source "$RND/.e2e/load-env.sh"` loads these from
`openwork/.env` + `aws-mac-vnc/.env` and pins the `react-native-deploy` bucket.)

---

## 5. Build on MacinCloud + publish to R2

```bash
node "$RND/bin/rn-deploy.js" build --profile preview --non-interactive
```

What happens on the Mac: SSH connect → verify Xcode/node/pod → clone your repo →
`npm install` → `expo prebuild` → `pod install` → `xcodebuild -sdk iphonesimulator`
(unsigned) → tar the `.app` → upload to `r2://react-native-deploy/builds/myapp/<id>/app.app.tgz`
→ append to the registry. Takes ~10–15 min. Prints the public artifact + install-page URLs.

List what's been published:

```bash
node "$RND/bin/rn-deploy.js" builds list
```

---

## 6. Preview it live on baguette (public URL)

```bash
node "$RND/scripts/baguette-preview.mjs"
```

On the Mac: boots an iPhone simulator → downloads the latest `.app` **from R2** →
`simctl install` + `launch` → starts baguette (`127.0.0.1:8421`) → starts a
`cloudflared` quick tunnel. It prints:

```
Open: https://<random>.trycloudflare.com/simulators
```

Open that in any browser to watch the app running on the simulator.

> The `trycloudflare.com` URL is **ephemeral** — it changes on each run and dies
> when `cloudflared` / the Mac stops. For a permanent URL you need a Cloudflare
> named tunnel bound to a domain on your Cloudflare account.

---

## Appendix: fully manual baguette (no script)

If you'd rather not use `baguette-preview.mjs`, SSH into the Mac and run these
(prefix every command with `eval "$(/opt/homebrew/bin/brew shellenv)";` so
`node`/`xcrun`/`cloudflared` are on PATH):

```bash
# pick a booted iPhone sim (or boot one)
UDID=$(xcrun simctl list devices booted | grep -Eo '[0-9A-F-]{36}' | head -1)
[ -z "$UDID" ] && UDID=$(xcrun simctl list devices available | grep iPhone | grep -Eo '[0-9A-F-]{36}' | head -1) && xcrun simctl boot "$UDID"

# install the app from its R2 URL (from `builds list`)
mkdir -p ~/prev && cd ~/prev
curl -fL "<artifact-url-from-builds-list>" -o app.tgz && tar -xzf app.tgz
APP=$(ls -d *.app | head -1)
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"

# baguette (install once)
B=$HOME/.baguette/v0.1.3/baguette-v0.1.3-macOS-arm64/Baguette
nohup "$B" serve --host 127.0.0.1 --port 8421 </dev/null >/tmp/baguette.log 2>&1 &

# cloudflared standalone binary (no sudo)
mkdir -p ~/.local/bin
curl -fL -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
tar -xzf /tmp/cf.tgz -C ~/.local/bin && chmod +x ~/.local/bin/cloudflared
nohup ~/.local/bin/cloudflared tunnel --url http://localhost:8421 </dev/null >/tmp/cf.log 2>&1 &
sleep 4; grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf.log | head -1
```
