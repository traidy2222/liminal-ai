# Install

Official one-command installers are hosted by Vireon Dynamics. They clone [liminal-ai](https://github.com/traidy2222/liminal-ai), build the monorepo, run setup, and open the web UI with persona bootstrap.

**Stage:** alpha (v0.0.13) — installers are onboarding helpers, not a GA release channel yet.

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
liminal update             # git pull + npm install + build
liminal path               # Print install directory
```

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
