#!/usr/bin/env bash
# Shared .env loading for the rn-preview entrypoints. Sourced, never executed.
#
# Canonical variable prefix is RN_PREVIEW_*. The older MAC_VNC_* names are still
# honoured so existing .env files keep working; RN_PREVIEW_* wins when both are set.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — copy .env.example to .env and fill in your Mac creds" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for _key in HOST USER PASSWORD SSH_PORT VNC_PASSWORD DEVICE RUNTIME BAGUETTE_PORT; do
  _new="RN_PREVIEW_${_key}"
  _old="MAC_VNC_${_key}"
  if [[ -z "${!_new:-}" && -n "${!_old:-}" ]]; then
    printf -v "$_new" '%s' "${!_old}"
  fi
done
unset _key _new _old

# require_env RN_PREVIEW_HOST -> exits with a message naming both accepted spellings.
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: ${name} (or MAC_VNC_${name#RN_PREVIEW_}) missing in .env" >&2
    exit 1
  fi
}
