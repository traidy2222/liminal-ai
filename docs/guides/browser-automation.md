# Browser automation

When a task needs JavaScript execution, a logged-in session, or clicking through a UI,
Liminal uses an app-owned browser with a persistent signed-in profile. On Windows desktop,
Playwright attaches to the exact embedded WebView2 tab you see. On other desktop platforms
and the standalone web interface, the panel streams the same persistent Chromium page that
the tools control. The browser family is gated by `AGENT_BROWSER` (on) and lazy activation unless
`AGENT_BROWSER_ALWAYS_ACTIVE` is set.

The Windows native browser's debugging port trusts other software and users on the
same computer. On shared computers, launch with `LIMINAL_BROWSER_NATIVE=0` to use
the shared browser stream instead. See [the local browser security boundary](https://github.com/traidy2222/liminal-ai/blob/main/SECURITY.md#local-desktop-browser-boundary).

Normal research uses the browser, including readable static pages. `web_search` and
`web_fetch` are hidden by default; enable `AGENT_WEB_SEARCH_FETCH=1` to opt into the
standalone web tools. See [Web research](./web-research.md).

## One-time setup

```bash
npm run browser:install   # downloads the Playwright Chromium build
```

## Tools

| Tool | Purpose |
| ---- | ------- |
| `browser_tabs` | Find your reusable tabs and user-opened tabs before opening another |
| `browser_open` / `browser_close` | Session lifecycle (cap with `AGENT_BROWSER_MAX_SESSIONS`) |
| `browser_navigate` | Go to a URL with timeout handling |
| `browser_snapshot` | Accessibility-oriented page state for the model to reason over |
| `browser_act` | Click, type, select — driven from snapshot refs |
| `browser_wait_for` | Wait on a selector, network idle, or a custom condition |
| `browser_extract` | Structured text out of the DOM |
| `browser_credentials` | Generate and autofill encrypted, origin-bound local passwords without putting them into model context |
| `browser_cookies` | Import/export cookies for the current site; full profile persistence is automatic |
| `browser_serve_file` | Expose a local HTML file for testing |
| `captcha_solve` | Optional 2captcha / CapSolver when `AGENT_CAPTCHA_KEY` is set |

A typical flow: `browser_open` → `browser_navigate` → `browser_snapshot` → `browser_act`
(from refs) → `browser_wait_for` → `browser_extract`.

## Page context and recovery

Saved tabs restore as lightweight metadata on launch. A tab loads in the shared signed-in
profile when selected or used by a tool. Inactive background pages sleep after two minutes;
the global live-page budget defaults to four. Visible pages, active agent tasks, user takeover,
playing media and detected unsaved edits are protected. Sleeping retains the tab's location,
owner and selection; waking reloads the page, so transient page state and browser back/forward
history are not retained. Closing or deleting a chat removes its tabs entirely.

Snapshots put the active dialog or main form ahead of navigation links. They include current
values, required and disabled states, selected options, validation feedback, and visible
controls inside embedded frames and open shadow roots. Password values are redacted.
`browser_extract` with `type: "forms"` also includes standalone fields outside a `<form>`.

Use the current snapshot's e-number references. Unchanged live controls retain their references across snapshots. Replaced or hidden controls expire.
Task tools default to that chat's selected tab, without another model call. Pass a handle
to switch tabs; an explicit unknown handle is rejected. Task tools use short `tab-…`
handles; the desktop keeps its full internal tab identity. Tools retain agent ownership.
An unknown handle reports available task tabs without executing an action.

`double_click_ref` and `double_click_text` support ordinary inline editing. Snapshot context includes machine-readable timestamps with surrounding labels. Text extraction preserves section headings; `browser_extract({type:"text",query:"Last updated"})` returns matching text, nearby text and the section heading path.

Action results report executed steps, not business success. Read the resulting validation or
confirmation state. On an action failure, completed-step counts and a fresh snapshot preserve
what already worked, so the next attempt can change the rejected value or finish the remaining
step. This feedback is ordinary tool-result data, not a site-specific prompt or retry script.

Local passwords are generated cryptographically and encrypted with Liminal's installation key.
`browser_credentials` returns metadata and a credential handle; autofill is restricted to the
saved origin. Preparing a password does not establish that signup completed. Actual phone or
identity verification still requires an available authorized verification channel.

## Stealth &amp; CAPTCHAs

The shared browser uses its actual browser identity. Legacy isolated browser helpers retain
`AGENT_BROWSER_STEALTH` for compatibility. For CAPTCHAs, set `AGENT_CAPTCHA_KEY` and
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
| `AGENT_BROWSER_MAX_SESSIONS` | `8` | Concurrent tabs per agent (app total: 24) |
| `AGENT_BROWSER_MAX_LIVE_TABS` | `4` | Live pages across all chats; eligible background tabs sleep when this budget is reached |
| `AGENT_BROWSER_SESSION_TTL_MS` | `120000` | Idle interval before an eligible background page sleeps (checked every 30 seconds) |
| `AGENT_CAPTCHA_KEY` | — (secret) | Enables `captcha_solve` |
| `AGENT_CAPTCHA_SERVICE` | `2captcha` | `2captcha` \| `capsolver` |

## Profile, tabs, and user takeover

Open **Browser** in the app to navigate, create/switch/close tabs, or sign in manually. The
agent sees the same live page, including form edits and signed-in state. Each chat has
its own tabs and selected tab in both interfaces. Switching chats restores that chat's
selection, and background chats cannot select or close another chat's tabs. Manual new
tabs belong to the current chat. **Take control**
pauses automation for that tab; **Resume agent** returns it. Agents have separate tabs and
cannot commandeer a sibling agent's tab. Tabs and local preview servers survive chat turns.

Cookies, local storage and IndexedDB are shared through the persistent profile, so
sign-ins remain available across chats. Open HTTP(S) tab URLs, chat ownership and each
chat's selection are restored on launch, preserving an explicit user takeover; a restart alone does not pause
automation. Temporary form contents and JavaScript execution state are not
restored. Websites can still expire or revoke a login. Local file tabs are not automatically
reopened. Browser settings include history and clearing the current site's saved data.

Windows stores the profile under `%LOCALAPPDATA%\\Liminal\\Browser`; other platforms use
`~/.liminal/browser`. Profiles are outside worktrees and app installations, so an update
does not replace them. Native WebView2 and standalone Chromium use separate engine data
directories; they do not import a personal Chrome profile or copy authentication between
engines. `LIMINAL_BROWSER_DATA_DIR` overrides the root for testing/portable deployments.
Run only one browser owner per profile directory.

Shared lifecycle: `packages/tools/src/families/browser/browser_runtime.ts`.

Run the local persistence regression with `AGENT_BROWSER_INTEGRATION=1` and
`node --import tsx --test packages/tools/src/families/browser/browser_workspace.test.ts`.

## Live browser benchmark

With the desktop app running, run `npm run benchmark:browser -- run-name` to exercise
public release notes, documentation, product comparison, weather, a checksum-file save,
and a live TodoMVC task workflow. Optional trailing case IDs select a subset, for example
`npm run benchmark:browser -- verify weather tasklist`. It uses the model configured in
the installed app and incurs normal provider usage. On Windows the native browser port
is discovered automatically; `LIMINAL_BENCH_CDP_PORT` overrides discovery. The command
is Windows-ready. On other platforms, set `LIMINAL_BENCH_CDP_PORT` to an existing
app-owned browser CDP port; automatic port discovery is not implemented there.

Results, tool traces, public-page evidence and artifacts are saved under
`.agent_artifacts/real-world-browser/<run-name>/`. Checks compare the release against
GitHub's API, compare the checksum file byte content, and inspect saved task state.
Product prices, forecast metadata scope and release-date wording still need source audit;
the report marks these cases explicitly. This is a small live evaluation, not a claim of
general human-level browser reliability. The runner closes only tabs owned by its test chats.
