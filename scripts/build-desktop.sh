#!/usr/bin/env bash
# Build Liminal Desktop for macOS or Linux (release + bundled liminald).
# Usage (repo root): ./scripts/build-desktop.sh macos|linux
set -euo pipefail

PLATFORM="${1:-}"
if [[ "$PLATFORM" != "macos" && "$PLATFORM" != "linux" ]]; then
  echo "Usage: $0 macos|linux" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/liminal_desktop"
SCRIPT_DIR="$REPO_ROOT/scripts"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter not found on PATH. https://docs.flutter.dev/get-started/install" >&2
  exit 1
fi

echo "==> Building liminald sidecar..."
(cd "$REPO_ROOT" && npm run build:sidecar)

cd "$APP_DIR"

case "$PLATFORM" in
  macos)
    if [[ ! -d macos ]]; then
      echo "==> Generating macOS runner (flutter create)..."
      flutter create . --project-name liminal_desktop --platforms=macos
    fi
  ;;
  linux)
    if [[ ! -d linux ]]; then
      echo "==> Generating Linux runner (flutter create)..."
      flutter create . --project-name liminal_desktop --platforms=linux
    fi
  ;;
esac

echo "==> flutter pub get"
flutter pub get

echo "==> flutter build $PLATFORM --release"
flutter build "$PLATFORM" --release

case "$PLATFORM" in
  macos)
    RELEASE_DIR="$APP_DIR/build/macos/Build/Products/Release/liminal_desktop.app/Contents/MacOS"
    BINARY="$RELEASE_DIR/liminal_desktop"
    ;;
  linux)
    RELEASE_DIR="$APP_DIR/build/linux/x64/release/bundle"
    BINARY="$RELEASE_DIR/liminal_desktop"
    ;;
esac

if [[ ! -f "$BINARY" ]]; then
  echo "Release binary missing: $BINARY" >&2
  exit 1
fi

echo "==> Bundling portable liminald..."
export COPY_NODE_MODULES_FROM_REPO="${COPY_NODE_MODULES_FROM_REPO:-0}"
bash "$SCRIPT_DIR/bundle-liminald-for-desktop.sh" "$RELEASE_DIR" "$REPO_ROOT"

echo ""
echo "Build complete."
echo "  Platform:   $PLATFORM"
echo "  Binary:     $BINARY"
echo "  Sidecar:    $RELEASE_DIR/liminald/repo"
case "$PLATFORM" in
  macos)
    echo "  Ship:       liminal_desktop.app (liminald lives in Contents/MacOS/)"
    ;;
  linux)
    echo "  Ship:       entire bundle/ folder"
    ;;
esac
