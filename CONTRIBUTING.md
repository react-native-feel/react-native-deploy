# Contributing to React Native Deploy

Thanks for helping. This is a small repository with a few independent packages; most changes
touch exactly one of them.

## Layout

| Directory | Package | What it is | Tests |
|---|---|---|---|
| [`eas/`](eas/) | `@react-native-feel/deploy` (`rnd`) | The EAS-compatible CLI that builds on GitHub Actions — the main product | `node --test` (~600 tests) |
| [`web/`](web/) | dashboard + install service | Vite dashboard and the Cloudflare Pages worker behind `/install/<id>`, uploads and the device registry | `vitest` |
| [`docs-site/`](docs-site/) | docs | VitePress site served at [reactnativefeel.com/deploy/docs](https://reactnativefeel.com/deploy/docs/) | `npm run build` |
| repo root (`src/`, `bin/`) | `rn-deploy` | The CLI that builds on a Mac you point it at (EC2 Mac, MacinCloud, cua) | `node --test` |
| [`gh-build/`](gh-build/) | `rn-build` | Predecessor of `rnd`, kept for existing users | `node --test` |
| [`sim-preview/`](sim-preview/) | `rn-preview` | iOS Simulator on a rented Mac, streamed to the browser | — |
| [`rnd-docs/`](rnd-docs/) | docs | Fumadocs site for `rn-deploy` | — |

No code is shared through a workspace: each package has its own `package.json` and lockfile, so
run `npm install` inside the directory you are working in. The exceptions are deliberate
imports: `web/` (via the `@eas` alias) and `docs-site/` import modules from `eas/src/` (the build
record mapper and the command spec) so the dashboard, the docs and the CLI cannot disagree.

## Setup

Node 20 or later.

```sh
git clone https://github.com/react-native-feel/react-native-deploy.git
cd react-native-deploy

cd eas && npm install && npm test          # rnd
cd ../web && npm install && npm test       # dashboard + install service
cd ../docs-site && npm install && npm run dev   # docs at http://localhost:5173/deploy/docs/
cd .. && npm install && npm test           # rn-deploy
```

To try your local `rnd` against a real app:

```sh
cd eas && npm link        # puts your checkout's `rnd` on PATH
cd ~/code/my-app && rnd build --platform ios --profile development
```

Real builds need a GitHub repository for the test app and, for anything signed, an App Store
Connect API key in [`asc`](https://github.com/rork/asc). Simulator and Android builds need
neither, which makes them the quickest end-to-end check.

## What `rnd` holds itself to

`rnd` promises to be a drop-in for `eas build` / `eas submit`, and the tests are how that stays
true. If your change touches one of these, the matching suite has to stay green:

- **`eas.json` resolution** — `eas/test/easjson/` runs every fixture through this port *and* the
  real `@expo/eas-json`, asserting identical results. A new field means a new fixture.
- **Commands and flags** — a contract test checks `eas/src/cli/spec.js` against `eas-cli`'s own
  manifest. Add or change commands in the spec, not ad hoc in commander.
- **CLI ↔ workflow** — the inputs the CLI dispatches must match what
  `eas/templates/eas-build.yml` declares. Change both sides together.
- **CLI ↔ dashboard** — both use `buildFromWorkflowRun` in `eas/src/models/build.js` to turn a workflow run into a build
  record. Don’t fork that logic in `web/`.

The command reference in the docs is generated from `eas/src/cli/spec.js`
(`docs-site/scripts/gen-commands.mjs`), so a new command shows up there automatically; edit the
`NOTES` table in that script to describe what it does.

## Pull requests

- Keep a PR to one change. A bug fix with its regression test is the ideal size.
- Run the tests for every package you touched. CI runs them all on each PR.
- If behaviour changes, update the docs page in `docs-site/guide/` in the same PR. Every docs
  page has an "Edit this page on GitHub" link for small fixes.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(cli): …`, `fix(web): …`, `docs: …`), which is what the release notes are built from.

## Reporting bugs

Open an issue with the `rnd --version`, the command you ran, the relevant part of your `eas.json`
and, for build failures, a link to the GitHub Actions run (or the failing step's log). Remove
anything secret first — tokens, `.p12` passwords, private keys.

Security problems: see [SECURITY.md](./SECURITY.md) instead of opening an issue.

## License

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).
