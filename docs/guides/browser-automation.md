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
| `browser_act` | Batch clicks, typing and selection using observed refs, with screenshot coordinates as a visual fallback |
| `browser_wait_for` | Wait on a selector, network idle, or a custom condition |
| `browser_extract` | Structured text out of the DOM |
| `browser_credentials` | Encrypted login autofill and shared account records that follow new chats |
| `browser_cookies` | Import/export cookies for the current site; full profile persistence is automatic |
| `browser_serve_file` | Expose a local HTML file for testing |
| `captcha_inspect` / `captcha_drag` / `captcha_solve` | Observe canvas challenges, drag loose pieces, or solve token/image/point tasks; paid solves require `AGENT_CAPTCHA_KEY` |

Browser navigation, actions, snapshots and waits attach the resulting viewport to
the next main-model request when the selected model supports images. No separate
vision model is required. Password fields are masked, and automatic screenshots
are kept out of saved chat text. Text-only models receive DOM/accessibility evidence.
Failed captures remove the previous image, so an old screen cannot masquerade as
the current view. Desktop agent tabs render offscreen while their panel is closed;
this supports background vision without bringing the app forward. Idle pages still
hibernate normally. Previews reuse the masked agent frames rather than requesting
another competing capture.

Control refs track the observed DOM element without adding attributes to the
control. They work inside embedded frames and open shadow roots; replacing the
element expires its ref. Custom ARIA dropdowns can use their normal keyboard
interface when an overlaid label prevents pointer interaction.

For a control visible only in the screenshot, `browser_act` accepts
`{ "op": "click_at", "x": 320, "y": 180 }`, followed by
`{ "op": "type_text", "value": "example" }` to type at the current focus.
Coordinates are viewport CSS pixels, matching the attached screenshot; they must
be inside the current viewport. Prefer refs when available and use
`browser_credentials` for passwords. A successful input action does not establish
that a form was accepted: read the resulting page feedback.

`drag_at` accepts `from_x`, `from_y`, `to_x`, `to_y` and an optional
`duration_ms` (100–5000; default 900). It uses held pointer movement and always
releases the button on cancellation or failure, including inside embedded frames.
Screenshot password redaction hides the field text rather than painting opaque
rectangles, so a password form behind a dialog cannot obscure that dialog's image.

A typical flow: `browser_open` → `browser_navigate` → `browser_snapshot` → `browser_act`
(from refs) → `browser_wait_for` → `browser_extract`.

## Page context and recovery

Saved tabs restore as lightweight metadata on launch. A tab loads in the shared signed-in
profile when selected or used by a tool. Inactive background pages sleep after two minutes;
the global live-page budget defaults to four. Visible pages, active agent tasks, user takeover,
playing media and detected unsaved edits are protected. Sleeping retains the tab's location,
owner and selection; waking reloads the page, so transient page state and browser back/forward
history are not retained. Closing or deleting a chat removes its tabs entirely.

Saved tabs in other chats do not exhaust a new chat's tab allowance. The live-page
budget applies independently of dormant tab metadata, and restoring or saving the
workspace preserves tabs beyond the former 24-tab total.

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

## Accounts across chats

Non-secret account records live in `~/.liminal/accounts/`, separate from encrypted
passwords and ordinary recall notes. Each new turn receives a bounded account
summary in the volatile context tail, so a follow-up can use an existing account
without first asking for a memory search. This adds no model calls and does not
change the static prompt prefix.

`browser_credentials({action: "accounts"})` lists account metadata without opening
a tab. `prepare` records an unconfirmed signup. After observing successful signup
or sign-in, use `record_account` with the resulting username, owner (`assistant`
or `user`), credential ID and a short quote from the current page. It records the
observed account and updates a site-normalized username without changing the
encrypted password or its origin restriction. Signup-to-app redirects can link
metadata across origins; password autofill still checks the exact saved origin.

Existing explicit global account facts are indexed as `reported`, rather than
silently treating them as a fresh login verification. New global account facts
saved with `remember` also update the directory. A unique signup credential from
the same chat is retained when a site changes the final username. Prepared,
blocked and closed accounts remain distinct from confirmed account records.

## Stealth &amp; CAPTCHAs

The shared browser uses its actual browser identity. Legacy isolated browser helpers retain
`AGENT_BROWSER_STEALTH` for compatibility. For CAPTCHAs, set `AGENT_CAPTCHA_KEY` and
`AGENT_CAPTCHA_SERVICE` (`2captcha` | `capsolver`) to enable `captcha_solve`.

Site-key detection covers the supported token providers; a custom visual puzzle
may have no site key. For a canvas challenge, `captcha_inspect`
returns the actual canvas ref and attaches its focused image without submitting a
paid task. This observes the challenge; the page's instructions determine its type.
For a loose-piece drag puzzle, `captcha_drag` requires that `visual_ref` and a `source_region`
tightly bounding the loose piece in the focused image's own pixel coordinates.
The backend sends the source as a separate instruction image and requests exactly
one matching destination. It rejects an answer on the source piece and applies the
validated drag directly, including all coordinate offsets. Its result is explicitly
`pending_submission`, rather than a false rejection. Submit the observed Next/Verify
control when required and read the site response before retrying or starting another round.
The gesture itself is not proof that the site accepted verification. Correctable
challenge/ref errors do not trip the provider circuit breaker; service outages still do.

General click-coordinate tasks can use `captcha_solve` with `type: "coordinates"`, a viewport `region`
(`x`, `y`, `width`, `height`), and short `instructions` describing the ordered
points. This mode uses 2Captcha's CoordinatesTask API. The backend captures a crop
of at most 1000 × 1000 CSS pixels and sends it directly to the service; screenshot
base64 does not pass through model context. Results contain viewport points for
`click_at` or `drag_at`, not a site token. A changed challenge invalidates the
result. Always read the website's response after applying the points: receipt of
coordinates does not establish that verification was accepted.

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
| `AGENT_BROWSER_MAX_SESSIONS` | `8` | Live and dormant tabs per agent/chat; other chats have separate allowances |
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

## Requested outcomes and completion

Multi-step browser work uses a per-turn outcome ledger through the existing `plan` tool.
The main model interprets the request, including implicit requirements. Explicit list
items are retained so a shorter plan cannot silently drop them. Progress updates cite
an `OBSERVATION_ID` and an exact quote from successful returned page state; failed
actions, field-value echoes and click receipts do not establish completion.

Unresolved outcomes hold back a final reply before chat or speech output. Recovery is
bounded and continues unfinished work; blocked work receives an incomplete handoff.
Completed outcomes do not trigger another audit. The ledger survives context compression,
and its counts are recorded in `turn_end.harnessMetrics.taskCompletion`.
This is evidence tracking, not a guarantee that the model interpreted every requirement
correctly. Visual-only results may need an appropriate readable observation.

Repeated identical click batches against unchanged page text and pixels stop before
another redundant click. The resulting error supplies a fresh page observation. Visual
changes continue to count as progress, even when the page text is unchanged.

Account records store their observed login method (`password`, `email_code`,
`magic_link` or `oauth`). Passwordless records do not link an unused generated
password. Each `browser_credentials` action has its own required fields; account
saves return an upsert receipt and refresh the live account snapshot immediately.

Editable outline rows expose `editor_path` and `editor_depth` from their rendered
DOM structure, including plaintext-only editors. Use `press_key_ref` to focus the
specific editor for shortcuts. Waits do not reset repeated-action detection, and
blinking carets are hidden in captured frames so they do not look like progress.
Completion evidence IDs remain stable across continuation turns in the same chat;
unrelated chats use separate evidence namespaces.

Disabled controls fail promptly with their current state instead of consuming a
full click timeout. Explicit-tab operations keep both failure observations and
native images on that tab; revisiting unchanged pixels still promotes the correct
image to the end of visual context. Op-less `{wait_ms: ...}` batches normalize to
a bounded wait without inferring any mutating action.

Verification inspection reports supported visible widgets and solver availability,
including reCAPTCHA keys exposed by the provider's iframe URL. Inspection does not
submit a paid solve. Applying a solution preserves hidden response fields, reports
when no field or callback accepted it, and returns the current page afterward.
A returned solution does not establish that the site accepted registration.
