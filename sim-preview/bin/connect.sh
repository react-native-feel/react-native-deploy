#!/usr/bin/env bash
# Legacy VNC path: sets up screen sharing + websockify on the remote Mac for the
# React/noVNC frontend in frontend/. Prefer ./bin/baguette.sh unless the host can't run it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bin/_env.sh
source "$SCRIPT_DIR/_env.sh"

require_env RN_PREVIEW_HOST
require_env RN_PREVIEW_USER
require_env RN_PREVIEW_PASSWORD
require_env RN_PREVIEW_VNC_PASSWORD

args=(
  stream
  --host "$RN_PREVIEW_HOST"
  --user "$RN_PREVIEW_USER"
  --password "$RN_PREVIEW_PASSWORD"
  --ssh-port "${RN_PREVIEW_SSH_PORT:-22}"
  --vnc-password "$RN_PREVIEW_VNC_PASSWORD"
  --tunnel
)

[[ -n "${RN_PREVIEW_DEVICE:-}" ]] && args+=(--device "$RN_PREVIEW_DEVICE")
[[ -n "${RN_PREVIEW_RUNTIME:-}" ]] && args+=(--runtime "$RN_PREVIEW_RUNTIME")

exec node "$SCRIPT_DIR/rn-preview.js" "${args[@]}" "$@"
