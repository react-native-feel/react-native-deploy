#!/usr/bin/env bash
# Opens the SSH tunnel that lets your local browser reach baguette on the remote Mac.
# Run AFTER `./bin/baguette.sh` has finished setup. Leave this terminal open while you
# use the simulator in the browser; Ctrl-C tears the tunnel down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — copy .env.example to .env and fill in your MacinCloud creds" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MAC_VNC_HOST:?MAC_VNC_HOST missing in .env}"
: "${MAC_VNC_USER:?MAC_VNC_USER missing in .env}"
: "${MAC_VNC_PASSWORD:?MAC_VNC_PASSWORD missing in .env}"

PORT="${MAC_VNC_BAGUETTE_PORT:-8421}"
SSH_PORT="${MAC_VNC_SSH_PORT:-22}"
URL="http://localhost:${PORT}/simulators"

echo "Opening tunnel ${PORT} -> ${MAC_VNC_HOST}:${PORT} ..."
echo "Once connected, your local browser can reach: ${URL}"
echo ""

# Open the browser shortly after the tunnel is ready. Backgrounded so it doesn't
# block — `open` on macOS hands off to the default browser and returns immediately.
( sleep 2 && open "$URL" ) &

# Prefer sshpass if installed (silent, scriptable). Fall back to plain ssh which
# will prompt for the password interactively — both keep the foreground SSH session
# alive for as long as you want the tunnel open.
if command -v sshpass >/dev/null 2>&1; then
  exec sshpass -p "$MAC_VNC_PASSWORD" ssh \
    -o StrictHostKeyChecking=accept-new \
    -p "$SSH_PORT" \
    -L "${PORT}:localhost:${PORT}" \
    "${MAC_VNC_USER}@${MAC_VNC_HOST}"
else
  echo "(sshpass not installed — you'll be prompted for the Mac password)"
  echo "  Install once with: brew install hudochenkov/sshpass/sshpass"
  echo ""
  exec ssh \
    -o StrictHostKeyChecking=accept-new \
    -p "$SSH_PORT" \
    -L "${PORT}:localhost:${PORT}" \
    "${MAC_VNC_USER}@${MAC_VNC_HOST}"
fi
