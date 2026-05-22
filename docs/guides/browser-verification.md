# Browser verification (Playwright)

Use the in-harness browser tools for frontend and local HTML checks. They keep a Chromium session open across steps (unlike one-shot open/close per call).

## Prerequisites

1. `AGENT_BROWSER=1` (default in harness settings).
2. Install Chromium once:

```bash
npm run browser:install
```

## Canonical loop

1. **Local HTML with assets** — `browser_serve_file` with a workspace-relative path → open the `SERVE_URL` (avoids `file://` CORS/module issues).
2. **Remote or simple file** — `browser_open` with `include_console:true` and `include_snapshot:true`.
3. Read `SNAPSHOT_REFS` (`e1`, `e2`, …) in the output.
4. `browser_act` with `session_id` and actions such as `click_ref`, `type_ref`, `goto`. `refresh_snapshot` defaults to true; refs also refresh automatically when the URL changes.
5. `browser_snapshot` after DOM changes if you need a dedicated refresh without actions.
6. `browser_close` when done.

Sessions are closed automatically at turn end.

## In-session navigation

- **`browser_navigate`** — `session_id` + `url` (keeps cookies/storage).
- **`browser_act` goto** — `{ "op": "goto", "url": "https://…" }` inside the actions array.

Do **not** pass `session_id` to `browser_open` — it always starts a new session.

## Forms and comboboxes

For JS-heavy forms (e.g. Herokuapp login) or OOUI comboboxes:

1. `focus_ref` → `clear_ref` → `type_ref` (not dozens of `press_key` chars).
2. Submit with `click_ref` on the button or `press_key` / `press_key_ref` with `Enter`.

Use `fill_ref` for simple native `<input>` fields. If validation fails or the URL does not change, switch to `type_ref`.

Combobox refs in `SNAPSHOT_REFS` include a hint: use `type_ref` + Enter.

## Rate-limited sites

On Hacker News (`news.ycombinator.com`), add `wait_ms` 800–1500 between story clicks, or use `goto` to the story URL instead of rapid link clicking.

## Lazy tool loading

When `AGENT_TOOL_LAZY=1`, run `activate_tool_family` with family `browser`, or set `AGENT_BROWSER_ALWAYS_ACTIVE=1` to keep browser tools in the balanced seed.

## Environment

| Variable | Purpose |
| -------- | ------- |
| `AGENT_BROWSER_WALL_MS` | Max wall time per browser tool call |
| `AGENT_BROWSER_NAV_TIMEOUT_MS` | `page.goto` timeout |
| `AGENT_BROWSER_FILE_ROOT` | Extra `file://` roots (`;`-separated) |
| `AGENT_BROWSER_SESSION_TTL_MS` | Idle session eviction |
| `AGENT_BROWSER_MAX_SESSIONS` | Concurrent sessions per task (1–4) |
| `AGENT_BROWSER_HEADED` | Visible window for local debugging |
| `AGENT_BROWSER_TYPE_DELAY_MS` | Delay between keys for `type_ref` (default 30ms) |

## Integration tests

```bash
npm run browser:install
set AGENT_BROWSER_INTEGRATION=1
npm run test --workspace=@liminal/tools
```

Eval scenario `browser-local-fixture-click` runs when `AGENT_BROWSER_INTEGRATION=1` is set during `npm run eval -w packages/eval`.
