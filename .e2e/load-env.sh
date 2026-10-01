#!/usr/bin/env bash
# Source this to load E2E credentials from their canonical locations into the
# environment the smoke test + rn-deploy expect. Usage:
#   source .e2e/load-env.sh && RN_DEPLOY_E2E=1 npm run test:e2e
set -a

_E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_REPO_DIR="$(cd "$_E2E_DIR/.." && pwd)"
R2_ENV="${RN_DEPLOY_E2E_R2_ENV:-/Users/rofi/conductor/workspaces/openwork/.env}"
# aws-mac-vnc/ was renamed sim-preview/; keep reading the old path if it is all there is.
_DEFAULT_MAC_ENV="$_REPO_DIR/sim-preview/.env"
[ -f "$_DEFAULT_MAC_ENV" ] || _DEFAULT_MAC_ENV="$_REPO_DIR/aws-mac-vnc/.env"
MAC_ENV="${RN_DEPLOY_E2E_MAC_ENV:-$_DEFAULT_MAC_ENV}"

[ -f "$R2_ENV" ] && . "$R2_ENV" || echo "warn: R2 env not found at $R2_ENV" >&2
[ -f "$MAC_ENV" ] && . "$MAC_ENV" || echo "warn: MacinCloud env not found at $MAC_ENV" >&2

# Map MacinCloud names -> generic names the harness reads. sim-preview's .env
# uses RN_PREVIEW_*; older files still use MAC_VNC_*.
export MAC_HOST="${RN_PREVIEW_HOST:-${MAC_VNC_HOST:-}}"
export MAC_USER="${RN_PREVIEW_USER:-${MAC_VNC_USER:-}}"
export MAC_PASSWORD="${RN_PREVIEW_PASSWORD:-${MAC_VNC_PASSWORD:-}}"
export MAC_PORT="${RN_PREVIEW_SSH_PORT:-${MAC_VNC_SSH_PORT:-22}}"

# rn-deploy uses its OWN bucket — only the account-level R2 keys/account-id are
# shared with openwork/.env. Override bucket + public URL so we never write to
# another project's bucket (e.g. umbral).
export R2_BUCKET="react-native-deploy"
export R2_PUBLIC_BASE_URL="https://pub-58ef2003db8642af966d3c08e6bfdf91.r2.dev"

set +a
echo "loaded: R2 bucket=${R2_BUCKET:-?} host=${MAC_HOST:-?}" >&2
