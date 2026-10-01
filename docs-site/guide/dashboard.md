# Dashboard & install service

The `web/` package is two things deployed together as one Cloudflare Worker:

| Path | What it is |
|---|---|
| `/deploy/dashboard/` | The dashboard: project overview, builds list with filters, build detail with phase timings, and the Install modal with its QR code |
| `/deploy/docs/` | This documentation |
| `/install/<dispatch-id>` | The public install page for one internal build |
| `/install/<dispatch-id>/manifest.plist` | The iOS over-the-air manifest |
| `/install/<dispatch-id>/app.ipa`, `app.apk` | The binary, streamed from R2 |
| `/api/uploads/…` | Upload API for the build workflow, protected by a bearer token |

## Using the dashboard

Open `/deploy/dashboard/`, choose **Connect a repository** and enter `owner/name`. A **public**
repository needs no token. For a private one, or to avoid GitHub's anonymous limit of 60
requests per hour, add a read-only token. It stays in your browser's local storage and is only
sent to `api.github.com`.

Until you connect, the dashboard shows clearly-labelled demo data.

## Deploy

You need a Cloudflare account, logged in with `npx wrangler login`.

```sh
cd web
npm install
npx wrangler r2 bucket create rn-eas-builds        # once

# once: the token the build workflow uploads with
openssl rand -hex 32 | tr -d '\n' > upload_token
npx wrangler secret put UPLOAD_TOKEN < upload_token

npm run deploy      # builds dashboard + docs, then deploys the Worker
```

`npm run deploy` prints the Worker's URL, for example
`https://rn-eas-deploy.<you>.workers.dev`. Then connect your app repository to it:

```sh
gh variable set EAS_INSTALL_URL --body "https://rn-eas-deploy.<you>.workers.dev"
gh secret set EAS_INSTALL_TOKEN < upload_token
rm upload_token
```

The configuration is in `web/wrangler.jsonc`: Workers static assets for the dashboard and docs,
an R2 binding named `BUILDS`, and `run_worker_first` so the Worker can route `/install` and
`/api` and give the dashboard's client-side routes a fallback.

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
