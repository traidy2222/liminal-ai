#!/usr/bin/env bash
# Liminal one-command installer (Linux / macOS / WSL)
# Usage: curl -fsSL https://vireondynamics.com/install/install.sh | bash
set -euo pipefail

REPO_URL="${LIMINAL_REPO_URL:-https://github.com/traidy2222/liminal-ai.git}"
BRANCH="${LIMINAL_BRANCH:-main}"

if [[ -n "${LIMINAL_INSTALL_DIR:-}" ]]; then
  INSTALL_DIR="$(cd "$(dirname "$LIMINAL_INSTALL_DIR")" && pwd)/$(basename "$LIMINAL_INSTALL_DIR")"
elif [[ -n "${LIMINAL_HOME:-}" ]]; then
  INSTALL_DIR="${LIMINAL_HOME}/liminal-ai"
else
  INSTALL_DIR="${HOME}/.liminal/liminal-ai"
fi

BIN_DIR="${LIMINAL_BIN_DIR:-${HOME}/.liminal/bin}"
SHIM_PATH="${BIN_DIR}/liminal"

info() { printf '==> %s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

require_cmd curl
require_cmd git

if ! command -v node >/dev/null 2>&1; then
  die "Node.js 22+ is required. Install from https://nodejs.org/ or use nvm/fnm."
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  die "Node.js 22+ required (found $(node -v))."
fi

if ! command -v npm >/dev/null 2>&1; then
  die "npm is required (install with Node.js 22+)."
fi

info "Install directory: ${INSTALL_DIR}"
mkdir -p "$(dirname "${INSTALL_DIR}")"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Updating existing install…"
  git -C "${INSTALL_DIR}" fetch origin "${BRANCH}" --quiet
  git -C "${INSTALL_DIR}" checkout "${BRANCH}" --quiet 2>/dev/null || true
  git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}" || warn "git pull failed; continuing with existing tree"
elif [[ -d "${INSTALL_DIR}" ]]; then
  die "${INSTALL_DIR} exists but is not a git repo. Remove it or set LIMINAL_INSTALL_DIR."
else
  info "Cloning ${REPO_URL}…"
  git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

info "Installing npm dependencies…"
(cd "${INSTALL_DIR}" && npm install)

info "Installing liminal CLI shim…"
mkdir -p "${BIN_DIR}"
cat >"${SHIM_PATH}" <<EOF
#!/usr/bin/env bash
exec node "${INSTALL_DIR}/scripts/liminal.mjs" "\$@"
EOF
chmod +x "${SHIM_PATH}"

append_path_snippet() {
  local profile="$1"
  local line="export PATH=\"${BIN_DIR}:\$PATH\""
  if [[ -f "${profile}" ]] && grep -Fq "${BIN_DIR}" "${profile}" 2>/dev/null; then
    return 0
  fi
  if [[ -w "${profile}" ]] || [[ ! -f "${profile}" ]]; then
    {
      echo ""
      echo "# Liminal CLI"
      echo "${line}"
    } >>"${profile}" 2>/dev/null && info "Added ${BIN_DIR} to ${profile}" || warn "Could not update ${profile}"
  fi
}

if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  append_path_snippet "${HOME}/.bashrc"
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ -f "${HOME}/.zshrc" ]]; then
    append_path_snippet "${HOME}/.zshrc"
  fi
  export PATH="${BIN_DIR}:${PATH}"
  warn "Open a new shell or run: export PATH=\"${BIN_DIR}:\$PATH\""
fi

SETUP_ARGS=(setup --skip-if-configured)
if [[ -n "${AGENT_API_KEY:-}" ]]; then
  SETUP_ARGS+=(--non-interactive)
fi

info "Running setup wizard…"
node "${INSTALL_DIR}/scripts/liminal.mjs" "${SETUP_ARGS[@]}"

info "Running doctor…"
node "${INSTALL_DIR}/scripts/liminal.mjs" doctor

if [[ "${LIMINAL_SKIP_LAUNCH:-}" == "1" ]]; then
  info "LIMINAL_SKIP_LAUNCH=1 — skipping web launch."
  info "Start manually: liminal web --bootstrap --open"
  exit 0
fi

info "Starting web UI (persona bootstrap)…"
exec node "${INSTALL_DIR}/scripts/liminal.mjs" web --bootstrap --open
