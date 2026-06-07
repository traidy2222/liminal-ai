# Liminal desktop apps

Liminal desktop apps are **persistent OS windows** — separate from the main chat shell — backed by persisted specs in `~/.liminal/apps/`. The agent spawns and updates them via harness tools; the sidecar refreshes data on a timer without running a full ReAct turn.

## Chat vs desktop window

| Surface | Mechanism | JS | Persists |
|---------|-----------|-----|----------|
| In-chat preview | ` ```html``` ` fence in assistant reply | no (static sanitizer) | no |
| Desktop widget | `spawn_app` (liminal_apps tools) | sandbox when `type: html` | yes — OS window |

When the user wants something **pinned on the desktop**, use **`spawn_app`**, not `write_file` to an HTML file in the workspace.

## Architecture

```
Agent (spawn_app / update_app / close_app)
    → LiminalAppManager (sidecar)
    → ~/.liminal/apps/manifest.json + cache/ + html/
    → WebSocket app_* events + GET /app_html + GET /app_proxy
    → Flutter AppWindowManager → OS window (WeatherApp native, others via HtmlApp WebView)
```

| Layer | Responsibility |
|-------|----------------|
| **Spec** | What app exists, props, refresh policy — JSON on disk, model-owned via tools, user-editable in Settings |
| **Cache** | Last fetched payload + `fetched_at` — `~/.liminal/apps/cache/<id>.json` |
| **HTML** | Rendered documents for html/markdown/chart/table/iframe — `~/.liminal/apps/html/<id>.html` |
| **Window** | OS chrome — default **widget mode** (frameless, compact, normal desktop z-order). Use `shell.mode: "window"` for a traditional app window. Closing hides the widget; use `close_app` or Settings **Remove** to delete. |

## Widget shell (default)

New apps default to `shell.mode: "widget"`:

```json
{
  "shell": {
    "mode": "widget",
    "frameless": true,
    "always_on_top": false,
    "skip_taskbar": false,
    "opacity": 1
  },
  "placement": { "width": 300, "height": 240 }
}
```

| Field | Default | Effect |
|-------|---------|--------|
| `mode` | `widget` | Compact floating widget vs full `window` |
| `frameless` | `true` (widget) | Hides OS title bar; drag via in-app header |
| `always_on_top` | `false` | When `true`, pins above all apps (sticky overlay). Default: normal z-order — visible on desktop, covered by focused apps |
| `placement` | per type | Size/position applied via `window_manager` |

Pass `shell: { mode: "window" }` on `spawn_app` or `update_app` for a traditional titled window.

## App types

| Type | Use case |
|------|----------|
| `weather` | Native Flutter weather panel (Open-Meteo) |
| `html` | Agent-authored custom UI (sandbox JS, optional `data_fetch`) |
| `markdown` | Live doc / brief panel |
| `chart` | Line or bar chart from `labels` + `series` |
| `table` | Sortable data table |
| `iframe` | HTTPS embed (allowlisted `src`) |

Example weather spawn:

```json
{
  "type": "weather",
  "title": "Weather — Home",
  "props": { "location": "Grantham, UK", "units": "metric" }
}
```

Example html widget (one complete document in `spawn_app` — streams like `write_file`):

```json
{
  "type": "html",
  "title": "Todo",
  "props": {
    "html": "<!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>",
    "interactivity": "sandbox",
    "proxy_hosts": ["api.example.com"]
  }
}
```

**Edits** (like `grep_file` + `edit_file` on the persisted html file):

1. `grep_app_html({ id, pattern })` — find anchors with line numbers
2. `update_app({ id, html_edit: { replacements: [{ search, replace }] } })` — patch in place
3. Full rewrite: `update_app({ id, props: { html: "..." } })` (also streams)

HTML always persists to `~/.liminal/apps/html/<id>.html` (`html_ref` in manifest).

## Harness tools

Bootstrapped on desktop sidecar (visible under lazy loading):

| Tool | Approval | Purpose |
|------|----------|---------|
| `list_app_types` | no | Catalog + prop schemas |
| `list_apps` | no | Specs + cache freshness |
| `read_app_html` | no | Numbered excerpt of widget HTML |
| `grep_app_html` | no | Search widget HTML with context |
| `preview_app_html` | no | Validate props before spawn |
| `spawn_app` | yes | Create app with full `props.html`, open widget window |
| `update_app` | no | `props.html` rewrite or `html_edit` patch / diff |
| `close_app` | yes | Remove spec + cache, close window |

Master switch: `AGENT_LIMINAL_APPS=1` (default on). Cap: `AGENT_APP_MAX_COUNT=8`. HTML size cap: `AGENT_APP_HTML_MAX_BYTES=409600`. Proxy host cap: `AGENT_APP_PROXY_MAX_HOSTS=8`.

On Liminal Desktop the sidecar sets `AGENT_LIMINAL_APPS_DESKTOP=1` so the harness injects routing guidance even before first tool use.

## Live data and proxy

Html/chart apps may declare `data_fetch` (sidecar refresh) and `proxy_hosts`. Widget JS calls:

```
GET http://127.0.0.1:<port>/app_proxy?token=<token>&appId=<id>&url=<encoded>
```

Only hosts allowlisted at spawn time are permitted. Sidecar pushes cache updates via `window.__LIMINAL__.applyData(cache)`.

## Desktop UI

- **Settings → Desktop apps** — list, edit weather location or html/markdown content, toggle **Open at startup**, Open / Refresh / Remove.
- Sub-windows load HTML from `/app_html`, apply widget chrome via `window_manager` (size, frameless), and talk to the main shell over `desktop_multi_window` method channels.
- Widget mode shows a compact rounded card with drag header, refresh, and hide (minimize) — not a full application window.

## Security

- Props validation rejects secret-like fields (API keys, tokens).
- HTML lives on disk under `~/.liminal/apps/html/`, not the workspace.
- App-window JS has no workspace or ambient API key access; network goes through token-gated `/app_proxy`.
- Chat embeds stay static HTML; richer JS only in sub-windows.

See also: [Rich message rendering](./rich-message-rendering.md) (in-chat HTML vs desktop windows).
