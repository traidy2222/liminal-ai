#!/usr/bin/env bash
# Package harness-only liminald/ zip for in-app harness updates.
# Usage: ./scripts/package-liminald-runtime.sh [--version X.Y.Z] [--copy-node-modules]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/scripts"
VERSION=""
COPY_NODE_MODULES_FROM_REPO="${COPY_NODE_MODULES_FROM_REPO:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?}"
      shift 2
      ;;
    --copy-node-modules)
      COPY_NODE_MODULES_FROM_REPO=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$REPO_ROOT/changelog/releases.json').currentVersion")"
fi

STAGING="$(mktemp -d)"
RELEASE_DIR="$STAGING/release"
mkdir -p "$RELEASE_DIR"
trap 'rm -rf "$STAGING"' EXIT

export COPY_NODE_MODULES_FROM_REPO
if [[ ! -f "$REPO_ROOT/packages/sidecar/dist/index.js" ]]; then
  echo "==> Building sidecar..."
  (cd "$REPO_ROOT" && npm run build:sidecar)
fi

bash "$SCRIPT_DIR/bundle-liminald-for-desktop.sh" "$RELEASE_DIR" "$REPO_ROOT"
bash "$SCRIPT_DIR/copy-desktop-updater.sh" "$RELEASE_DIR/liminald"

DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"
ARCHIVE_NAME="liminald-runtime-v${VERSION}.zip"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
rm -f "$ARCHIVE_PATH"

echo "==> Creating $ARCHIVE_NAME ..."
(cd "$RELEASE_DIR" && zip -r -q "$ARCHIVE_PATH" liminald)

if command -v sha256sum >/dev/null 2>&1; then
  HASH="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
else
  HASH="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
fi
printf '%s  %s\n' "$HASH" "$ARCHIVE_NAME" >"${ARCHIVE_PATH}.sha256"

echo ""
echo "Package ready."
echo "  Zip:    $ARCHIVE_PATH"
echo "  SHA256: $HASH"
