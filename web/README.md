# Deploy dashboard

The web half of the EAS replacement — a reproduction of expo.dev's deploy
screens — plus the install service behind its QR codes. Live at
**[react-native-deploy.pages.dev](https://react-native-deploy.pages.dev)**:

| Path | What |
|---|---|
| `/deploy/dashboard/` | this dashboard |
| `/deploy/docs/` | the rn-eas docs ([`../docs-site`](../docs-site)) |
| `/install/<dispatch-id>` | public install page for one internal build (`worker/`) |
| `/api/uploads/…` | token-guarded R2 upload API for the build workflow (`worker/`) |
| `/register-device/<token>` | public device registration: Apple's Profile Service enrollment (`worker/devices.js`) |
| `/api/devices/…` | token-guarded device registry in D1, for `rnd device:*` and the build workflow |

```bash
npm install
npm run dev      # http://localhost:5177/deploy/dashboard/
npm test         # mapper + install-service tests
npm run deploy   # build dashboard + docs, then `wrangler pages deploy`
```

First-time Cloudflare setup (R2 bucket, D1 database, Pages project, `UPLOAD_TOKEN`) is in the docs:
[Dashboard & install service](https://react-native-deploy.pages.dev/deploy/docs/guide/dashboard#deploy).

## What it shows

| Screen | Route | Contents |
|---|---|---|
| Project overview | `/` | The "Develop & deploy" cards: development builds, production builds, submissions |
| Builds | `/builds` | The table, with Platform / Channel / Runtime / Profile / Mode filters |
| Build detail | `/builds/:id` | Metadata strip, artifact card, timings, and the step-by-step phase timeline |
| Submissions | `/submissions` | What the CLI recorded, plus a pointer at App Store Connect |

The **Install** button opens the "Install on a test device" modal: a QR code, the
platform-specific instructions, and a copyable install link.

The QR encodes the build's *page* URL rather than the artifact. That indirection
is deliberate and is what EAS does — the phone lands somewhere that can check the
build is still available and hand it the right kind of link, instead of
downloading a zip it cannot open.

## Where the data comes from

There is no backend. Two sources feed the same views:

- **Demo data** (the default), so the page renders before anything is connected.
  These are raw *workflow run* fixtures, not pre-baked records — they go through
  the real mapper, so the demo exercises the projection rather than illustrating it.
- **A GitHub repository.** Enter `owner/name` and a read-only token; both stay in
  `localStorage` and the token is only ever sent to `api.github.com`.

Either way the components consume EAS `BuildFragment`-shaped records produced by
[`../eas/src/models/build.js`](../eas/src/models/build.js) — the *same* module the
CLI uses. One mapping means `eas build:list --json` and this UI can never
disagree about a build's status, duration, or artifact.

That sharing is why the build id hash is an isomorphic SHA-256 rather than
`node:crypto`: the browser has to derive the same id the CLI prints, and Web
Crypto's digest is async.

## Deploying under /deploy/dashboard

`base: '/deploy/dashboard/'` in `vite.config.js` and a matching router `basename` are both
required — getting one wrong produces a page that works in dev and 404s every
chunk in production. `worker/index.js` gives `/deploy/dashboard/builds/:id` its SPA
fallback on a hard refresh (and keeps missing hashed assets as real 404s).

## Tests

`npm test` runs 59 tests. 29 cover the mapper: status translation for every GitHub
conclusion, build id stability and UUID shape, EAS's build titles, and the
invariants the views depend on — that a failed build has a diagnosable error
code, that nothing succeeds after a failing step, and that the phase timings sum
to the reported build time. 11 cover the install service
(`worker/install.test.js`): upload-key validation, manifest escaping, the
itms-services URL, the per-device install page and its desktop QR code. The last 19
(`worker/devices.test.js`) run the Worker against the real D1 migration on `node:sqlite`: the
device API, the whole Profile Service round trip, expired and forged registrations, and the
install page's provisioned-devices list.
