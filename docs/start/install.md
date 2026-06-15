# Install

Official one-command installers are hosted by Vireon Dynamics. They clone [liminal-ai](https://github.com/traidy2222/liminal-ai), build the monorepo, run setup, and open the web UI with persona bootstrap.

**Stage:** beta (v0.1.0 public preview) — tagged releases and hosted installers are the supported onboarding path; GA packaging is still on the roadmap. Pro users can sign in with `liminal login` for managed inference instead of pasting an API key.

## One command (recommended)

**Linux / macOS / WSL:**

```bash
curl -fsSL https://vireondynamics.com/install/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://vireondynamics.com/install/install.ps1 | iex
```

The installer will:

1. Clone or update Liminal under a fixed directory
2. Run `npm install` and `npm run build` when needed
3. Walk you through **API key + provider** setup (writes `.env`)
4. Run **`liminal doctor`** preflight checks
5. Start the **web UI** with **persona bootstrap** and open your browser

Scripts are also in the repo at `scripts/install.sh` and `scripts/install.ps1` if you prefer to inspect them before running.

### Install locations

| Platform | Default path | CLI shim |
|----------|--------------|----------|
| Linux / macOS / WSL | `~/.liminal/liminal-ai` | `~/.liminal/bin/liminal` |
| Windows | `%LOCALAPPDATA%\liminal\liminal-ai` | `%LOCALAPPDATA%\liminal\bin\liminal.cmd` |

Override with environment variables:

| Variable | Purpose |
|----------|---------|
| `LIMINAL_INSTALL_DIR` | Full path to the repo clone |
| `LIMINAL_HOME` | Parent dir (`$LIMINAL_HOME/liminal-ai`) |
| `LIMINAL_SKIP_LAUNCH=1` | Skip auto-start of web UI after install |
| `AGENT_API_KEY` | Non-interactive setup (CI / scripted install) |
| `LIMINAL_REPO_URL` | Alternate git remote (default: liminal-ai on GitHub) |

## `liminal` CLI

After install, use `liminal` from any terminal (new shell may be required for PATH):

```bash
liminal setup              # Re-run wizard (or first-run from cloned repo)
liminal doctor             # Verify Node, builds, API key, port
liminal web --bootstrap    # Production web UI
liminal web --bootstrap --open   # Web UI + open browser
liminal tui --bootstrap    # Terminal UI
liminal update             # git pull + npm install + build (git installs)
liminal update --check     # portable desktop: compare to latest GitHub Release
liminal update --harness-only   # apply harness-only update (sidecar stopped)
liminal path               # Print install directory
```

### Liminal Desktop (portable zip)

Download Windows / macOS / Linux builds from [GitHub Releases](https://github.com/traidy2222/liminal-ai/releases) (`v{version}-desktop` tags) or the [install page](https://www.vireondynamics.com/liminal/get-started#desktop-app).

**Auto-update:** On launch, the desktop app checks GitHub Releases when you are on a portable install (`liminald/bundle.json` beside the executable). **Harness updates** download `liminald-runtime-v{version}.zip` and reconnect the sidecar in place. **App updates** download the full platform archive and restart once. Manage this under **Settings → About & updates**, or run `liminal update --check` from a folder containing `liminald/`.

| Env | Purpose |
|-----|---------|
| `LIMINAL_SKIP_UPDATE_CHECK=1` | Disable automatic check on launch |
| `LIMINAL_UPDATE_CHANNEL=beta` | Include pre-releases (default feed during beta) |
| `LIMINAL_DESKTOP_EXE_DIR` | Override install directory for CLI update commands |

Git-based installs (`~/.liminal/liminal-ai`) continue to use `liminal update` (pull + build). Dev builds with `LIMINAL_REPO_ROOT` skip release checks.

From a **cloned repo** without global shim:

```bash
npm run setup
npm run doctor
node scripts/liminal.mjs web --bootstrap --open
```

### Setup flags

```bash
liminal setup --skip-if-configured   # Skip prompts if API key exists
liminal setup --force                # Reconfigure even when configured
liminal setup --non-interactive      # Requires AGENT_API_KEY in environment
liminal setup --no-launch            # Do not start web after setup
```

### Non-interactive / CI

```bash
export AGENT_API_KEY=sk-...
export AGENT_API_BASE_URL=https://openrouter.ai/api/v1   # optional
export AGENT_MODEL=deepseek/deepseek-v4-pro               # optional
liminal setup --non-interactive --skip-if-configured
liminal doctor
```

## Manual install (contributors)

If you develop from a git checkout:

```bash
git clone https://github.com/traidy2222/liminal-ai.git
cd liminal-ai
npm install
npm run setup          # interactive wizard → .env + build
npm run web -- --bootstrap
```

Or copy [`.env.example`](../../.env.example) manually and run `npm run build`.

See [Quickstart](./quickstart.md) for smoke tests and next steps.

## Troubleshooting install

Run **`liminal doctor`** first — it checks Node 22+, npm 10+, `.env` API key, `core`/`tools` builds, and port availability.

| Symptom | Fix |
|---------|-----|
| `liminal: command not found` | Open a new terminal, or `export PATH="$HOME/.liminal/bin:$PATH"` |
| Node too old | Install Node 22+ from [nodejs.org](https://nodejs.org/) or nvm/fnm |
| Doctor: core/tools missing | `npm run build` in install dir |
| Port in use | Set `PORT=3002` in `.env` or stop the other process |
| Provider smoke test warning | Key or base URL wrong — re-run `liminal setup --force` |

Full operator guide: [Troubleshooting](../operations/troubleshooting.md).

## Platform notes

- **Linux servers (SSH):** use `liminal web --bootstrap` without `--open`; tunnel port 3001 if needed.
- **WSL:** same as Linux; browser open typically launches Windows default browser.
- **Updates:** `liminal update` from the install directory (requires git).

Not in v1: npm global publish, systemd/launchd services, Docker, `.deb`/`.rpm` packages.
