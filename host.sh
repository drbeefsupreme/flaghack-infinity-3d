#!/usr/bin/env bash
# Host a FLAGHACK ∞ multiplayer burn from this machine; friends join from their browsers.
#
#   ./host.sh --password <pw> [--port 8787] [--name "<server name>"] [--bind <address>]
#   ./host.sh --help
#
# Checks Node.js, installs dependencies when they are missing or stale, builds the client and the
# host, then starts it (same as `npm run host -- ...` in web/). Ctrl+C ends the burn.
set -euo pipefail

cd "$(dirname "$0")/web"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 (or 20.19+) with npm is needed: https://nodejs.org, or with nvm: nvm install 22" >&2
  exit 1
fi
# Vite (the build) needs ^20.19 or >= 22.12.
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a === 20 && b >= 19) || (a === 22 && b >= 12) || a >= 23 ? 0 : 1)'; then
  echo "Node.js 22 (or 20.19+) is needed; this machine has $(node --version). With nvm: nvm install 22" >&2
  exit 1
fi

# npm records the installed tree in node_modules/.package-lock.json: missing or older than the
# lockfile means the dependencies are missing or out of date.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies..."
  npm ci --no-audit --no-fund
fi

for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    npx vite build --ssr server/main.ts --logLevel error
    exec node dist-server/main.js --help
  fi
done

echo "Building the client and the host..."
npx vite build --logLevel warn
npx vite build --ssr server/main.ts --logLevel warn
exec node --enable-source-maps dist-server/main.js "$@"
