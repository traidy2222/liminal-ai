#!/usr/bin/env bash
# Copy updater scripts into liminald/updater/ beside a desktop release bundle.
set -euo pipefail

LIMINALD_ROOT="${1:?liminald root required}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$LIMINALD_ROOT/updater"
mkdir -p "$DEST"

cp "$REPO_ROOT/scripts/apply-desktop-update.mjs" "$DEST/"
cp "$REPO_ROOT/scripts/lib/update-release.mjs" "$DEST/"
cp "$REPO_ROOT/scripts/lib/desktop-release-names.mjs" "$DEST/"
cp "$REPO_ROOT/scripts/lib/apply-app-swap.mjs" "$DEST/"
cp "$REPO_ROOT/scripts/relaunch-desktop.sh" "$DEST/"
cp "$REPO_ROOT/scripts/relaunch-desktop-windows.ps1" "$DEST/"

echo "==> Copied desktop updater -> $DEST"
