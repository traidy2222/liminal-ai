# Browser automation

When a task needs JavaScript execution, a logged-in session, or clicking through a UI,
Liminal drives a real headless **Chromium** via Playwright. The browser family wraps the full
session lifecycle and is gated by `AGENT_BROWSER` (on) and lazy activation unless
`AGENT_BROWSER_ALWAYS_ACTIVE` is set.

Use `web_fetch` for static pages (faster, cheaper) — see [Web research](./web-research.md) —
and the browser only when the page is client-rendered or interactive.

## One-time setup

```bash
npm run browser:install   # downloads the Playwright Chromium build
```

## Tools

| Tool | Purpose |
| ---- | ------- |
| `browser_open` / `browser_close` | Session lifecycle (cap with `AGENT_BROWSER_MAX_SESSIONS`) |
| `browser_navigate` | Go to a URL with timeout handling |
| `browser_snapshot` | Accessibility-oriented page state for the model to reason over |
| `browser_act` | Click, type, select — driven from snapshot refs |
| `browser_wait_for` | Wait on a selector, network idle, or a custom condition |
| `browser_extract` | Structured text out of the DOM |
| `browser_cookies` | Read/write cookies for session reuse |
| `browser_serve_file` | Expose a local HTML file for testing |
| `captcha_solve` | Optional 2captcha / CapSolver when `AGENT_CAPTCHA_KEY` is set |

A typical flow: `browser_open` → `browser_navigate` → `browser_snapshot` → `browser_act`
(from refs) → `browser_wait_for` → `browser_extract`.

## Stealth &amp; CAPTCHAs

`AGENT_BROWSER_STEALTH` (on) patches common automation fingerprints with `addInitScript` and
disables the AutomationControlled flag. For CAPTCHAs, set `AGENT_CAPTCHA_KEY` and
`AGENT_CAPTCHA_SERVICE` (`2captcha` | `capsolver`) to enable `captcha_solve`.

## Developer workflows

- Verify a staging UI after API changes without first writing a Playwright suite.
- Capture a repro for a bug that only appears logged in.
- Scrape docs behind client-rendered SPAs.
- Pair with `web_search` when a task starts at "find the official docs" and ends at "click
  through the admin console."

## Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_BROWSER` | on | Master switch for the browser family |
| `AGENT_BROWSER_HEADED` | off | Run visible Chromium (useful when debugging selectors) |
| `AGENT_BROWSER_ALWAYS_ACTIVE` | off | Keep the family loaded under lazy loading |
| `AGENT_BROWSER_STEALTH` | on | Fingerprint patches + disable AutomationControlled |
| `AGENT_BROWSER_MAX_SESSIONS` | `2` | Concurrent browser sessions |
| `AGENT_CAPTCHA_KEY` | — (secret) | Enables `captcha_solve` |
| `AGENT_CAPTCHA_SERVICE` | `2captcha` | `2captcha` \| `capsolver` |

Shared lifecycle: `packages/tools/src/browser_runtime.ts`.
