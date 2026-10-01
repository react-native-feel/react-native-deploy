#!/usr/bin/env bash
# Opens the SSH tunnel that lets your local browser reach baguette on the remote Mac.
# Run AFTER `./bin/baguette.sh` has finished setup. Leave this terminal open while you
# use the simulator in the browser; Ctrl-C tears the tunnel down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bin/_env.sh
source "$SCRIPT_DIR/_env.sh"

require_env RN_PREVIEW_HOST
require_env RN_PREVIEW_USER
require_env RN_PREVIEW_PASSWORD

PORT="${RN_PREVIEW_BAGUETTE_PORT:-8421}"
SSH_PORT="${RN_PREVIEW_SSH_PORT:-22}"
URL="http://localhost:${PORT}/simulators"

echo "Opening tunnel ${PORT} -> ${RN_PREVIEW_HOST}:${PORT} ..."
echo "Once connected, your local browser can reach: ${URL}"
echo ""

# Open the browser shortly after the tunnel is ready. Backgrounded so it doesn't
# block — `open` on macOS hands off to the default browser and returns immediately.
( sleep 2 && open "$URL" ) &

# Prefer sshpass if installed (silent, scriptable). Fall back to plain ssh which
# will prompt for the password interactively — both keep the foreground SSH session
# alive for as long as you want the tunnel open.
if command -v sshpass >/dev/null 2>&1; then
  exec sshpass -p "$RN_PREVIEW_PASSWORD" ssh \
    -o StrictHostKeyChecking=accept-new \
    -p "$SSH_PORT" \
    -L "${PORT}:localhost:${PORT}" \
    "${RN_PREVIEW_USER}@${RN_PREVIEW_HOST}"
else
  echo "(sshpass not installed — you'll be prompted for the Mac password)"
  echo "  Install once with: brew install hudochenkov/sshpass/sshpass"
  echo ""
  exec ssh \
    -o StrictHostKeyChecking=accept-new \
    -p "$SSH_PORT" \
    -L "${PORT}:localhost:${PORT}" \
    "${RN_PREVIEW_USER}@${RN_PREVIEW_HOST}"
fi
