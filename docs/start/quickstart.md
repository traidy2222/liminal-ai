# Quickstart

Get Liminal running locally in a few minutes.

## Prerequisites

- Node.js 22+
- npm 10+
- An OpenAI-compatible API key (OpenRouter, OpenAI, etc.)

## One-command install (new users)

**Linux / macOS / WSL:**

```bash
curl -fsSL https://raw.githubusercontent.com/traidy2222/liminal-ai/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/traidy2222/liminal-ai/main/scripts/install.ps1 | iex
```

This clones Liminal, runs the setup wizard, verifies the install, and opens the web UI with persona bootstrap. Details: [Install guide](./install.md).

## Manual install (contributors)

### 1. Install dependencies

```bash
npm install
```

### 2. Setup wizard

```bash
npm run setup
```

The wizard writes `.env` (API key, provider, port), runs `npm install` / `npm run build` if needed, and optionally smoke-tests your provider.

Alternatively, copy `.env.example` at the repository root and set at minimum:

```bash
AGENT_API_KEY=your_key_here
```

Optional overrides in `.env`: `AGENT_API_BASE_URL`, `AGENT_MODEL`, `PORT`, `AGENT_VAULT_PATH`, `AGENT_WORKSPACE_ROOT`.

Product tuning (distill, lazy tools, web timeouts) lives in **typed defaults** and the **Web Settings** modal — not in `.env`. See [Configuration basics](./configuration-basics.md).

### 3. Build

If you skipped the wizard, compile `core` and `tools` before TUI/web/eval:

```bash
npm run build
# or
npm run build -w packages/core
npm run build -w packages/tools
```

### 4. Run

```bash
# Terminal UI
npm run tui

# Web UI (API + static client on PORT, default 3001)
npm run web

# Web with Vite hot reload (API :3001, client :5173)
npm run web:dev
```

Or use the CLI:

```bash
node scripts/liminal.mjs web --bootstrap --open
node scripts/liminal.mjs tui --bootstrap
npm run doctor
```

First-run **persona bootstrap** may appear in web/TUI unless disabled (`AGENT_PERSONA_BOOTSTRAP=0`). Force re-show: `npm run web -- --bootstrap` or `npm run tui -- --bootstrap`.

## Smoke test

1. Ask: “List packages under `packages/` and summarize each.” — expect real `read_file` / `list_dir` paths.
2. Open **Settings** in web and toggle a non-secret flag (e.g. UI verbosity) — saves to `.agent_runtime_prefs.json`.
3. After changing `packages/core` or `packages/tools`, rebuild and restart the interface.

## Next steps

| Goal | Read |
|------|------|
| Install paths & CI | [Install](./install.md) |
| Configure flags | [Configuration basics](./configuration-basics.md), [Environment reference](../reference/environment.md) |
| Research / vault briefs | [Research with web tools](../guides/research-with-web-tools.md), [Vault briefs](../guides/vault-briefs-and-updates.md) |
| Architecture | [Architecture](../concepts/architecture.md) |
| Problems | [Troubleshooting](../operations/troubleshooting.md) |
