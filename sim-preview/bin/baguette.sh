#!/usr/bin/env bash
# Sets up and starts baguette on the remote Mac (install, boot simulator, serve on
# 127.0.0.1:8421), then disconnects. Run ./bin/tunnel.sh next to reach it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bin/_env.sh
source "$SCRIPT_DIR/_env.sh"

require_env RN_PREVIEW_HOST
require_env RN_PREVIEW_USER
require_env RN_PREVIEW_PASSWORD

args=(
  baguette
  --host "$RN_PREVIEW_HOST"
  --user "$RN_PREVIEW_USER"
  --password "$RN_PREVIEW_PASSWORD"
  --ssh-port "${RN_PREVIEW_SSH_PORT:-22}"
  --port "${RN_PREVIEW_BAGUETTE_PORT:-8421}"
)

[[ -n "${RN_PREVIEW_DEVICE:-}" ]] && args+=(--device "$RN_PREVIEW_DEVICE")
[[ -n "${RN_PREVIEW_RUNTIME:-}" ]] && args+=(--runtime "$RN_PREVIEW_RUNTIME")

exec node "$SCRIPT_DIR/rn-preview.js" "${args[@]}" "$@"
