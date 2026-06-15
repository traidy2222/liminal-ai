#!/usr/bin/env bash
# Wait for parent desktop process, then apply a downloaded app archive.
set -euo pipefail

PARENT_PID="${1:?parent pid}"
EXE_DIR="${2:?exe dir}"
ARCHIVE_PATH="${3:?archive path}"

UPDATER_DIR="$EXE_DIR/liminald/updater"
APPLY_SCRIPT="$UPDATER_DIR/apply-desktop-update.mjs"

wait_for_pid() {
  local pid="$1"
  local deadline=$((SECONDS + 120))
  while kill -0 "$pid" 2>/dev/null; do
    if (( SECONDS > deadline )); then
      echo "Timed out waiting for parent PID $pid" >&2
      exit 1
    fi
    sleep 0.4
  done
}

platform="linux"
if [[ "$(uname -s)" == "Darwin" ]]; then
  platform="macos"
fi

echo "Waiting for Liminal Desktop (PID $PARENT_PID) to exit..."
wait_for_pid "$PARENT_PID"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required on PATH to apply app updates" >&2
  exit 1
fi

node "$APPLY_SCRIPT" \
  --mode app \
  --exe-dir "$EXE_DIR" \
  --archive "$ARCHIVE_PATH" \
  --platform "$platform" \
  --relaunch-pid 0

rm -f "$EXE_DIR/pending_update.json"
echo "App update applied."
