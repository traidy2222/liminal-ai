#!/usr/bin/env bash
# Build + archive Liminal Desktop for GitHub Releases (macOS or Linux).
# Usage (repo root):
#   ./scripts/package-desktop.sh macos
#   ./scripts/package-desktop.sh linux --version 0.0.18
#   COPY_NODE_MODULES_FROM_REPO=1 ./scripts/package-desktop.sh linux
set -euo pipefail

PLATFORM="${1:-}"
shift || true

if [[ "$PLATFORM" != "macos" && "$PLATFORM" != "linux" ]]; then
  echo "Usage: $0 macos|linux [--version X.Y.Z] [--skip-build]" >&2
  exit 1
fi

VERSION=""
SKIP_BUILD=0
COPY_NODE_MODULES_FROM_REPO="${COPY_NODE_MODULES_FROM_REPO:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/liminal_desktop"
DIST_DIR="$REPO_ROOT/dist"
SCRIPT_DIR="$REPO_ROOT/scripts"

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$REPO_ROOT/changelog/releases.json').currentVersion")"
fi
[[ -n "$VERSION" ]] || VERSION="0.0.0"

resolve_paths() {
  case "$PLATFORM" in
    macos)
      RELEASE_DIR="$APP_DIR/build/macos/Build/Products/Release/liminal_desktop.app/Contents/MacOS"
      PRODUCTS_DIR="$APP_DIR/build/macos/Build/Products/Release"
      ARCHIVE_ROOT="$PRODUCTS_DIR/liminal_desktop.app"
      ;;
    linux)
      RELEASE_DIR="$APP_DIR/build/linux/x64/release/bundle"
      ARCHIVE_ROOT="$RELEASE_DIR"
      ;;
  esac
}

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  export COPY_NODE_MODULES_FROM_REPO
  bash "$SCRIPT_DIR/build-desktop.sh" "$PLATFORM"
else
  resolve_paths
  if [[ "$PLATFORM" == "macos" && ! -f "$RELEASE_DIR/liminal_desktop" ]]; then
    echo "macOS release missing. Run without --skip-build first." >&2
    exit 1
  fi
  if [[ "$PLATFORM" == "linux" && ! -f "$RELEASE_DIR/liminal_desktop" ]]; then
    echo "Linux release missing. Run without --skip-build first." >&2
    exit 1
  fi
  export COPY_NODE_MODULES_FROM_REPO
  bash "$SCRIPT_DIR/bundle-liminald-for-desktop.sh" "$RELEASE_DIR" "$REPO_ROOT"
fi

resolve_paths
mkdir -p "$DIST_DIR"

write_readme() {
  local readme_path="$1"
  local platform_req install_steps
  if [[ "$PLATFORM" == "macos" ]]; then
    platform_req="macOS 11+ (Apple Silicon; unsigned alpha build)"
    install_steps="1. Unzip and move liminal_desktop.app to Applications (or run in place).
2. First launch: right-click -> Open if Gatekeeper blocks an unsigned build.
3. Keep liminald/ inside the app (Contents/MacOS/liminald)."
  else
    platform_req="Linux x64 (glibc-based distro)"
    install_steps="1. Extract the tar.gz anywhere.
2. Run ./liminal_desktop from the bundle folder.
3. Keep the liminald/ folder next to the binary."
  fi
  cat >"$readme_path" <<EOF
Liminal Desktop $VERSION ($PLATFORM alpha)

Requirements:
- $platform_req
- Node.js 20+ on PATH (https://nodejs.org/)
- API key: copy liminald/repo/.env.example to liminald/repo/.env and set AGENT_API_KEY,
  or sign in with Vireon inside the app (Pro managed inference).

Install:
$install_steps

License: FSL-1.1-MIT — https://github.com/traidy2222/liminal-ai/blob/main/LICENSE
EOF
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

case "$PLATFORM" in
  macos)
    write_readme "$RELEASE_DIR/README.txt"
    ARCHIVE_NAME="liminal-desktop-macos-arm64-v${VERSION}.zip"
    ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
    rm -f "$ARCHIVE_PATH"
    echo "==> Creating $ARCHIVE_NAME ..."
    (cd "$PRODUCTS_DIR" && zip -r -q "$ARCHIVE_PATH" "liminal_desktop.app")
    ;;
  linux)
    write_readme "$ARCHIVE_ROOT/README.txt"
    ARCHIVE_NAME="liminal-desktop-linux-x64-v${VERSION}.tar.gz"
    ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
    rm -f "$ARCHIVE_PATH"
    echo "==> Creating $ARCHIVE_NAME ..."
    tar -czf "$ARCHIVE_PATH" -C "$(dirname "$ARCHIVE_ROOT")" "$(basename "$ARCHIVE_ROOT")"
    ;;
esac

HASH="$(sha256_file "$ARCHIVE_PATH")"
HASH_PATH="${ARCHIVE_PATH}.sha256"
printf '%s  %s\n' "$HASH" "$ARCHIVE_NAME" >"$HASH_PATH"

echo ""
echo "Package ready."
echo "  Archive: $ARCHIVE_PATH"
echo "  SHA256:  $HASH"
echo "  Hash:    $HASH_PATH"
