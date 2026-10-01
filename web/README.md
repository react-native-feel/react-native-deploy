# Deploy dashboard

The web half of the EAS replacement — a reproduction of expo.dev's deploy
screens, served at **reactnativefeel.com/deploy/dashboard**.
(`/deploy` itself is the marketing page, which lives in the `chatbot-factory-ui` repo.)

```bash
npm install
npm run dev      # http://localhost:5177/deploy/dashboard/
npm run build    # static output in dist/, base-pathed at /deploy/dashboard/
npm test
```

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
chunk in production. The build output is static; point the path at `dist/` with
an SPA fallback so `/deploy/dashboard/builds/:id` resolves on a hard refresh.

## Tests

`npm test` runs 29 tests over the mapper: status translation for every GitHub
conclusion, build id stability and UUID shape, EAS's build titles, and the
invariants the views depend on — that a failed build has a diagnosable error
code, that nothing succeeds after a failing step, and that the phase timings sum
to the reported build time.
