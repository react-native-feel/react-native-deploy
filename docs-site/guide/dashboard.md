# Dashboard & install service

The `web/` package is deployed as one Cloudflare Pages project — for this repository,
**[react-native-deploy.pages.dev](https://react-native-deploy.pages.dev)**:

| Path | What it is |
|---|---|
| `/deploy/dashboard/` | The dashboard: project overview, builds list with filters, build detail with phase timings, and the Install modal with its QR code |
| `/deploy/docs/` | This documentation |
| `/install/<dispatch-id>` | The public install page for one internal build |
| `/install/<dispatch-id>/manifest.plist` | The iOS over-the-air manifest |
| `/install/<dispatch-id>/app.ipa`, `app.apk` | The binary, streamed from R2 |
| `/api/uploads/…` | Upload API for the build workflow, protected by a bearer token |
| `/register-device/<token>` | Public device registration: the page a `rnd device:create` QR opens |
| `/api/devices/…` | The device registry (D1), for the CLI and the workflow, protected by the same token |

## Using the dashboard

Open `/deploy/dashboard/`, choose **Connect a repository** and enter `owner/name`. A **public**
repository needs no token. For a private one, or to avoid GitHub's anonymous limit of 60
requests per hour, add a read-only token. It stays in your browser's local storage and is only
sent to `api.github.com`.

Until you connect, the dashboard shows clearly-labelled demo data.

## Deploy

You need a Cloudflare account, logged in with `npx wrangler login`. Pick a project name; it
becomes `<name>.pages.dev`. The commands below use `react-native-deploy`.

```sh
cd web
npm install
npx wrangler r2 bucket create rn-eas-builds                     # once
npx wrangler d1 create rn-deploy-devices                        # once: paste its id into wrangler.jsonc
npx wrangler d1 migrations apply rn-deploy-devices --remote     # once, and after a migration is added
npx wrangler pages project create react-native-deploy \
  --production-branch master --force                            # once (see below)

# once: the token the build workflow uploads with
openssl rand -hex 32 | tr -d '\n' > upload_token
npx wrangler pages secret put UPLOAD_TOKEN --project-name react-native-deploy < upload_token

npm run deploy      # builds dashboard + docs, then `wrangler pages deploy`
```

Then connect your app repository to it:

```sh
gh variable set EAS_INSTALL_URL --body "https://react-native-deploy.pages.dev"
gh secret set EAS_INSTALL_TOKEN < upload_token
rm upload_token
```

::: warning Three things that catch people out
- **Secrets apply to the next deployment.** `pages secret put` doesn't change the running
  deployment; run `npm run deploy` again after setting or rotating `UPLOAD_TOKEN`. Until then,
  uploads get `401`.
- **`--force` on `project create`.** Recent wrangler versions turn `pages project create` into a
  Workers deployment (a `*.workers.dev` URL) unless you pass `--force`. Only `project create`
  needs it.
- **Accounts allow 100 Pages projects.** `project create` fails with code `8000027` at the limit;
  delete an unused project first. Projects with custom domains must have those removed before
  they can be deleted.
:::

The configuration is `web/wrangler.jsonc`: the build output directory, an R2 binding named
`BUILDS` for the builds, and a D1 binding named `DB` for the [device registry](/guide/internal-distribution#registering-devices).
The registry's schema is in `web/migrations/`. Without the D1 binding everything else works, and the
device routes answer `503`. `npm run deploy` writes `.pages-dist/_worker.js`, which re-exports `web/worker/index.js`:
Pages "advanced mode", so every request reaches the Worker code. It routes `/install`, `/register-device` and `/api`,
serves the dashboard and docs from the static assets, and gives the dashboard's client-side routes
a fallback.

## How uploads work

The workflow's **Publish for install** step uploads in 50 MiB parts with R2 multipart, so large
IPAs fit under the Workers request-size limit. `meta.json` is written last, and the install page
appears only once it exists, so a page never points at a half-uploaded binary.

The upload API only accepts `builds/<uuid>/meta.json`, `app.ipa` or `app.apk`, so a leaked token
cannot overwrite anything else in the bucket. The token check is constant-time.

## Retention

R2 objects don't expire on their own, unlike GitHub artifacts (90 days). Add an
[R2 lifecycle rule](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) on
`builds/` if you want them to.
