# rn-preview

**Preview loop.** Stream an iOS Simulator from a remote Mac (e.g. MacinCloud) to a browser on your laptop, so you can look at the app without owning a Mac.

> Sibling project: [`rn-deploy`](../README.md) at the repo root is the **release loop** — it builds a signed `.ipa` on an AWS EC2 Mac and ships it to TestFlight. The two tools are independent: different Macs, different config, no shared code. See the root README for which one to reach for.

Two backends:

- **`baguette`** — modern HTTP/H.264 path. Self-contained web UI, no VNC, no sudo. Recommended.
- **`stream`** — legacy VNC + websockify + noVNC frontend. Kept for hosts where baguette can't run.

This README covers the baguette flow end-to-end. Both flows assume a MacinCloud (or similar) managed Mac that you reach over SSH.

## Prerequisites

**On your laptop**
- Node.js 20+
- A MacinCloud (or other) Mac you can SSH into

**On the remote Mac** (auto-checked by the script — fail-fast with a clear error)
- Apple Silicon (`arm64`)
- macOS 15+
- Xcode 26+ with iOS Simulator runtimes
- An iOS simulator named in `RN_PREVIEW_DEVICE` already created in Xcode (the script will create one if missing, but it's faster if it exists)

## One-time setup

```bash
cd sim-preview
npm install
cp .env.example .env
# edit .env — paste your MacinCloud host/user/password
```

`.env` is gitignored — never commit it. Fields are documented in `.env.example`.

Optional but recommended (so you stop typing your Mac password):

```bash
brew install hudochenkov/sshpass/sshpass
```

`bin/tunnel.sh` will detect sshpass and use it; without it the SSH session prompts interactively.

## Daily use — two terminals

### Terminal 1 — start baguette on the remote

```bash
./bin/baguette.sh
```

What it does:
1. SSH into the remote Mac
2. Verify Apple Silicon + macOS 15+ + Xcode + curl
3. Download baguette v0.1.3 prebuilt binary into `~/.baguette/` (idempotent — skipped on re-runs)
4. Resolve the simulator UDID via `xcrun simctl` (creates the device if it doesn't exist)
5. Boot the simulator via baguette (`already booted` is treated as success)
6. Start `baguette serve` on `127.0.0.1:8421` via `nohup` so it survives the SSH disconnect
7. Wait until the port answers, then disconnect

You can re-run this anytime — install is skipped if present, boot is no-op'd if booted, server is restarted on each run.

### Terminal 2 — open the tunnel and browser

```bash
./bin/tunnel.sh
```

What it does:
- Opens `ssh -L 8421:localhost:8421 user@host` so your laptop's port 8421 forwards to the remote's port 8421 (where baguette is bound)
- Opens `http://localhost:8421/simulators` in your default browser after a short delay
- Stays in the foreground holding the tunnel — Ctrl-C to tear it down

If you'd rather run the SSH command by hand, the URL printed by `./bin/baguette.sh` is what to use:

```bash
ssh -L 8421:localhost:8421 user@TX0XX.macincloud.com
# in your local browser:  http://localhost:8421/simulators
```

## Why localhost forwards to the remote

`-L LOCAL:HOST:REMOTE_PORT` tells SSH: "listen on **my** local port, and when anything connects to it, tunnel through to `HOST:REMOTE_PORT` resolved on the **remote** end." So `-L 8421:localhost:8421` means "your local 8421 → remote's localhost:8421" — and `localhost` from the remote's view is exactly where baguette is bound. Baguette intentionally doesn't expose itself on a public interface (no auth), so SSH gives you an authenticated wormhole.

## Troubleshooting

**`Homebrew not found` or `brew install` permission errors** — Expected on managed plans where `/opt/homebrew` is owned by another user. The baguette flow doesn't use brew at all (downloads the prebuilt tarball directly), so this only matters for the legacy `stream` flow.

**`current state: Booted` from baguette boot** — Now handled silently. If you see it, pull latest.

**Tunnel command "hangs"** — That's correct. The SSH session is the tunnel; it must stay alive. Open `http://localhost:8421/simulators` in your **local** browser (not inside the SSH session — that would try to launch a browser on the remote, which has no GUI session).

**Port 8421 already in use locally** — Another process on your laptop has the port. Either kill it (`lsof -iTCP:8421 -sTCP:LISTEN`) or pick a different port via `RN_PREVIEW_BAGUETTE_PORT` in `.env` and use it on both ends.

**`baguette serve` doesn't start** — On the remote: `tail -n 50 /tmp/baguette.log` for diagnostics.

## Legacy VNC flow

If you need the old VNC path (e.g. host doesn't satisfy baguette's requirements):

```bash
./bin/connect.sh
cd frontend && npm run dev
# open http://localhost:5173
```

Same `.env` file. Routes traffic via websockify on port 6080 and the React/noVNC frontend in `frontend/`.

## Layout

```
sim-preview/
├── bin/
│   ├── baguette.sh        # baguette flow entrypoint
│   ├── tunnel.sh          # opens SSH tunnel + browser
│   ├── connect.sh         # legacy VNC flow entrypoint
│   ├── _env.sh            # shared .env loading (RN_PREVIEW_*, MAC_VNC_* fallback)
│   └── rn-preview.js      # Node CLI (commander)
├── src/
│   ├── cli.js             # registers `stream`, `baguette`, `status` commands
│   ├── commands/
│   │   ├── baguette.js    # baguette orchestration
│   │   └── stream.js      # legacy VNC orchestration + status
│   └── remote/
│       ├── ssh.js         # node-ssh wrapper with retry (password or key auth)
│       ├── baguette-setup.js   # download/install/boot/serve over SSH
│       └── vnc-setup.js   # legacy VNC + websockify setup
├── frontend/              # React/noVNC viewer (only used by `stream`)
├── .env.example
└── package.json
```

State is written to `.rn-preview-state.json` (gitignored) in whichever directory you run from.

## Note on naming

This package used to be called `aws-mac-vnc` / `mac-vnc`. Both halves of that name had gone stale: it targets MacinCloud rather than AWS, and the recommended backend is baguette over HTTP rather than VNC. Variables are now `RN_PREVIEW_*`; `bin/_env.sh` still accepts the old `MAC_VNC_*` spelling, so an existing `.env` needs no edits.
