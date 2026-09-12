#!/bin/bash
set -euo pipefail
export PATH="${HOME}/.local/share/mise/shims:${HOME}/.local/share/mise/installs/node/24/bin:/usr/bin:/bin:${PATH:-}"
REPO="${OPENCLINXR_REPO:-/Volumes/files/src/openclinxr}"
if [[ -f "$REPO/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env.local"
  set +a
fi
if [[ -z "${OPENCODE_API_KEY:-}" && -f "$HOME/.config/opencode/go-api-key" ]]; then
  OPENCODE_API_KEY="$(cat "$HOME/.config/opencode/go-api-key")"
  export OPENCODE_API_KEY
fi
cd "$REPO"
exec "$REPO/node_modules/.bin/tsx" "$REPO/tools/openclinxr/openclaw/provider-failover-proxy.ts"
