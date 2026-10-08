#!/bin/sh
set -e
# Linux node_modules live in named volumes (native better-sqlite3 build must not clash with the host's).
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
mkdir -p "$DATA_DIR" "$(dirname "$DB_PATH")"
# Nx keeps running-task state in .nx/workspace-data (a persisted volume). After the container is
# killed mid-task, a stale entry makes the next `nx serve` fail with "Recursive task invocation
# detected". The folder is derived data, so start from a clean one.
rm -rf .nx/workspace-data
# DB migrations run on API start (openDatabase → drizzle migrate).
exec "$@"
