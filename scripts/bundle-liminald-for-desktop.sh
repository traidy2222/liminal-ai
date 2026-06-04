#!/usr/bin/env bash
# Stage portable liminald beside the desktop release folder (macOS MacOS/, Linux bundle/, etc.).
# Usage: bundle-liminald-for-desktop.sh <ReleaseDir> <RepoRoot>
set -euo pipefail

RELEASE_DIR="${1:?ReleaseDir required}"
REPO_ROOT="${2:?RepoRoot required}"

REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SIDECAR_ENTRY="$REPO_ROOT/packages/sidecar/dist/index.js"
if [[ ! -f "$SIDECAR_ENTRY" ]]; then
  echo "Missing $SIDECAR_ENTRY. Run: npm run build:sidecar" >&2
  exit 1
fi

BUNDLE_ROOT="$RELEASE_DIR/liminald"
BUNDLE_REPO="$BUNDLE_ROOT/repo"
PACKAGES=(core protocol tools sidecar)

rm -rf "$BUNDLE_REPO"
mkdir -p "$BUNDLE_REPO/packages"

echo "==> Staging portable liminald repo -> $BUNDLE_REPO"

cp "$SCRIPT_DIR/desktop-runtime.package.json" "$BUNDLE_REPO/package.json"

for name in "${PACKAGES[@]}"; do
  src_pkg="$REPO_ROOT/packages/$name"
  dest_pkg="$BUNDLE_REPO/packages/$name"
  if [[ ! -f "$src_pkg/dist/index.js" ]]; then
    echo "Missing packages/$name/dist - run: npm run build:sidecar" >&2
    exit 1
  fi
  mkdir -p "$dest_pkg"
  cp "$src_pkg/package.json" "$dest_pkg/"
  cp -R "$src_pkg/dist" "$dest_pkg/"
done

[[ -f "$REPO_ROOT/LICENSE" ]] && cp "$REPO_ROOT/LICENSE" "$BUNDLE_REPO/LICENSE"
[[ -f "$REPO_ROOT/.env.example" ]] && cp "$REPO_ROOT/.env.example" "$BUNDLE_REPO/.env.example"

cat >"$BUNDLE_REPO/README.txt" <<'EOF'
Liminal Desktop — bundled harness runtime (do not edit unless you know what you are doing).

First run:
  1. Install Node.js 20+ (https://nodejs.org/) and ensure `node` is on PATH.
  2. Copy `.env.example` to `.env` in this folder and set `AGENT_API_KEY`.
  3. Run the Liminal Desktop app from its release folder (not this directory).

Pro users can sign in inside the app instead of using a local API key.
EOF

if [[ "${COPY_NODE_MODULES_FROM_REPO:-0}" == "1" && -d "$REPO_ROOT/node_modules" ]]; then
  echo "==> Copying node_modules from monorepo (fast path)..."
  mkdir -p "$BUNDLE_REPO/node_modules"
  cp -a "$REPO_ROOT/node_modules/." "$BUNDLE_REPO/node_modules/"
else
  echo "==> npm install --omit=dev (portable runtime, may take a few minutes)..."
  (cd "$BUNDLE_REPO" && npm install --omit=dev --no-audit --no-fund)
fi

if [[ ! -f "$BUNDLE_REPO/packages/sidecar/dist/index.js" ]]; then
  echo "Bundle incomplete: sidecar dist missing after install" >&2
  exit 1
fi

SCRIPT_REL="liminald/repo/packages/sidecar/dist/index.js"
ROOT_REL="liminald/repo"
LIMINAL_VERSION="$(node -p "require('$REPO_ROOT/changelog/releases.json').currentVersion")"
BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p "$BUNDLE_ROOT"
node -e "
const fs = require('fs');
const manifest = {
  layout: 'portable-v1',
  repoRoot: process.argv[1],
  sidecarScript: process.argv[2],
  builtAt: process.argv[3],
  liminalVersion: process.argv[4],
};
fs.writeFileSync(process.argv[5], JSON.stringify(manifest, null, 2));
" "$ROOT_REL" "$SCRIPT_REL" "$BUILT_AT" "$LIMINAL_VERSION" "$BUNDLE_ROOT/bundle.json"

echo "==> bundle.json (paths relative to release binary folder)"
echo "    repoRoot:      $ROOT_REL"
echo "    sidecarScript: $SCRIPT_REL"
