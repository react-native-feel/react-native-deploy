#!/usr/bin/env bash
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

args=(
  baguette
  --host "$MAC_VNC_HOST"
  --user "$MAC_VNC_USER"
  --password "$MAC_VNC_PASSWORD"
  --ssh-port "${MAC_VNC_SSH_PORT:-22}"
  --port "${MAC_VNC_BAGUETTE_PORT:-8421}"
)

[[ -n "${MAC_VNC_DEVICE:-}" ]] && args+=(--device "$MAC_VNC_DEVICE")
[[ -n "${MAC_VNC_RUNTIME:-}" ]] && args+=(--runtime "$MAC_VNC_RUNTIME")

exec node "$SCRIPT_DIR/mac-vnc.js" "${args[@]}" "$@"
