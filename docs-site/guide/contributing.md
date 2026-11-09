# Contributing

React Native Deploy is free and open source under the MIT License. The code, these docs and the
issue tracker live at
**[github.com/react-native-feel/react-native-deploy](https://github.com/react-native-feel/react-native-deploy)**.

## Ways to help

- **Report a bug.** [Open an issue](https://github.com/react-native-feel/react-native-deploy/issues/new)
  with your `rnd --version`, the command you ran, the relevant part of `eas.json` and a link to
  the GitHub Actions run if a build failed. Strip tokens, passwords and keys first.
- **Fix the docs.** Every page has an *Edit this page on GitHub* link at the bottom.
- **Close a gap with EAS.** [Differences from EAS](/guide/differences) lists what `rnd` doesn't do
  yet; Android submission and `--auto-submit` are the big ones.
- **Report a security problem** privately through
  [GitHub's advisory form](https://github.com/react-native-feel/react-native-deploy/security/advisories/new),
  not in an issue.

## Run it from source

Node 20 or later.

```sh
git clone https://github.com/react-native-feel/react-native-deploy.git
cd react-native-deploy/eas
npm install
npm test        # ~600 tests, under a second
npm link        # your checkout's `rnd` on PATH
```

Then use `rnd` in any app as usual. Simulator and Android builds need no Apple credentials, so
they are the quickest way to check a change end to end.

The other packages:

| Directory | What | Run |
|---|---|---|
| `eas/` | The `rnd` CLI | `npm test` |
| `web/` | Dashboard and install service | `npm run dev`, `npm test` |
| `docs-site/` | These docs | `npm run dev` → `http://localhost:5173/deploy/docs/` |

## The tests that keep it a drop-in

`rnd` is only useful if it behaves like `eas`, so compatibility is tested rather than assumed:

- **`eas.json`** — every fixture is resolved by this port *and* by the real `@expo/eas-json`,
  and the results must be identical.
- **Commands and flags** — a contract test compares the CLI's command table with `eas-cli`'s own
  manifest.
- **CLI and workflow** — the inputs the CLI dispatches must match the ones the workflow template
  declares.
- **CLI and dashboard** — both turn workflow runs into build records with the same function.

If your change touches one of these, extend the matching suite in the same pull request.
The [Commands](/reference/commands) page is generated from the CLI's command table, so new
commands appear there without editing the docs by hand.

The full guide, including commit conventions, is
[CONTRIBUTING.md](https://github.com/react-native-feel/react-native-deploy/blob/master/CONTRIBUTING.md).
