#!/bin/bash
# Installs the dependencies in a Claude Code on the web session, as a convenience for the
# shared agent setup in AGENTS.md and docs/development.md. This makes `npm test` and
# `npm run check` work from the start. The app itself (Electron, code-server) does not run
# there: Electron 44 downloads its binary only on first run, so the install stays small.
# `npm ci` instead of `npm install`: it installs exactly what package-lock.json says and never
# rewrites it. `npm install` with a different npm version rewrote the lock file's metadata
# ("license", "peer") and left an uncommitted change in every session. `npm ci` deletes
# node_modules first, but with only these devDependencies that takes a few seconds.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund
