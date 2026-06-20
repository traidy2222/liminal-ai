# Liminal marketing captures

## Recommended: unattended batch capture

**One command, all prompts, no focus steal.** Headless browser drives the real harness over HTTP; prompts run back-to-back in a single chat. Safe to keep working while it runs.

```bash
# Terminal 1 — run everything (starts web if needed, captures, syncs website)
npm run marketing:publish

# Terminal 2 — block until done (exit 0 = success)
npm run marketing:watch

# Optional Windows toast when finished
set MARKETING_CAPTURE_NOTIFY=1
npm run marketing:publish
```

Capture only (no website sync):

```bash
npm run marketing:capture:unattended
```

**Also need real Flutter window shots?** Add desktop capture (minimized, batch chat):

```bash
npm run marketing:publish:all
# or: npm run marketing:publish -- --with-desktop
```

Legacy desktop-only publish (steals focus more):

```bash
npm run marketing:publish:desktop
```

| Env | Purpose |
|-----|---------|
| `MARKETING_REUSE_CHAT=1` | One chat for all prompts (on by default for unattended) |
| `MARKETING_CAPTURE_NO_FOCUS=1` | Show desktop without focus steal — **do not minimize** (Flutter stops painting when minimized) |
| `MARKETING_SKIP_WEB_START=1` | API must already be on `MARKETING_API_URL` |
| `MARKETING_CAPTURE_NOTIFY=1` | Toast + bell when scripts finish |
| `VIREON_WEBSITE_ROOT` | Path to vireondynamics-website for sync |

Progress: `assets/marketing/.capture-status.json` and `npm run marketing:status`.

---

## Two modes (read this)

| Mode | Command | Accurate? |
|------|---------|-----------|
| **Unattended (recommended)** | `npm run marketing:capture:unattended` | **Yes** — real harness, headless web, batch chat |
| **Desktop (Flutter window)** | `npm run marketing:capture:desktop` | **Yes** — real harness via `liminald`, window capture |
| **Live web (headed)** | `npm run marketing:capture:live` | **Yes** — real harness, visible browser |
| **Illustrative fixtures** | `npm run marketing:capture` | **No** — hand-drawn UI states for layout only |

The PNGs/GIFs already in this folder from `marketing:capture` are **staged examples**, not recordings of the model executing those prompts. Do not ship them as proof of capability without running live capture.

---

## Desktop capture (accurate · 1:1 with shipped app)

**Requires:** Vireon Pro sign-in for managed inference (or `MARKETING_SKIP_MODEL=1` + BYOK key), built desktop (`npm run desktop:build:windows`), Windows for window capture, FFmpeg on PATH.

The capture script sets `LIMINALD_ATTACH=1` on the desktop process so Flutter health-check reconnects **attach** to liminald instead of killing it (which used to drop the capture WebSocket mid-run).

Captures pin **Vireon managed inference** — **`zai.glm-5`** main + **`zai.glm-4.7-flash`** fast (Bedrock). Requires Pro sign-in (`liminal login`) or managed routing in runtime prefs. Override: `MARKETING_AGENT_MODEL` / `MARKETING_AGENT_FAST_MODEL` or disable pinning: `MARKETING_SKIP_MODEL=1`.

```bash
# Builds liminal_desktop.exe if needed, launches app, drives harness over WebSocket
npm run marketing:capture:desktop

# One prompt
node scripts/capture-marketing-desktop.mjs --id desktop-coding-debounce

# Reuse already-running desktop
set MARKETING_DESKTOP_SKIP_LAUNCH=1
npm run marketing:capture:desktop
```

**Outputs per prompt:**

- `assets/marketing/desktop-*.png` — screenshot of the **real** `liminal_desktop` window after the turn
- `assets/marketing/desktop-*.gif` / `desktop-*.mp4` — frames while the harness was busy
- `assets/marketing/recordings/<id>/session.jsonl` — copy of the session log
- `assets/marketing/recordings/<id>/messages.json` — parsed tool trace (used by Remotion)
- `assets/marketing/desktop-manifest.json` — tools used, duration, slide copy
- `assets/desktop-ui.png` — hero copy for website (from coding prompt)

Remotion desktop compositions (`Liminal-Desktop-*`) read `desktop-manifest.json` automatically.

---

## Live capture (accurate · web UI)

**Requires:** Vireon Pro sign-in for managed inference (or `MARKETING_SKIP_MODEL=1` + `AGENT_API_KEY`), web stack running. Model pack pinned to **GLM-5 + GLM 4.7 Flash** (see desktop section for overrides).

```bash
# Terminal 1 — API + UI
npm run web:dev
# or: npm run web  (built client on :3001)

# Terminal 2 — run prompts (costs API tokens; minutes per prompt)
npm run marketing:capture:live
```

One prompt:

```bash
node scripts/capture-marketing-live.mjs --id live-coding-debounce
```

**Outputs per prompt:**

- `assets/marketing/live-*.png` — screenshot of the **real** web UI after the turn
- `assets/marketing/live-*.gif` — frames taken while the harness was busy
- `assets/marketing/recordings/<id>/session.jsonl` — copy of the session log
- `assets/marketing/recordings/<id>/messages.json` — parsed tool trace for replay
- `assets/marketing/live-manifest.json` — tools used, duration, errors

**Replay in browser** (verify before publishing):

`http://localhost:5173/marketing.html?recording=live-code-ship-test`

Approval modals: the live script clicks **AUTHORIZE** when a destructive tool blocks.

---

## Illustrative fixtures (layout only)

```bash
npm run web:dev
npm run marketing:capture          # basic scenarios
npm run marketing:capture:advanced # harder *looking* scenarios (still fake)
```

Preview: `http://localhost:5173/marketing.html?scenario=coding-typescript`

Edit fiction in `packages/web/client/marketing/scenarios.ts`.

---

## Marketing prompts (real harness)

**Source of truth:** `scripts/lib/marketing-prompts.mjs` (desktop + live capture import this).

| ID suffix | What it proves | Expected tools |
|-----------|----------------|----------------|
| `code-ship-test` | Plan → implement → `node:test` verify (self-heal once) | `plan`, `write_file`, `run_shell` |
| `repo-react-trace` | Monorepo orientation + ReAct loop explanation | `repo_map`, `grep_file`, `read_file_chunked` |
| `memory-recall` | Persistent typed memory + hybrid recall | `remember`, `recall_relevant`, `memory_stats` |
| `web-research-cite` | Primary-source research with URLs + field names | `web_search`, `web_fetch` |
| `harness-test-run` | *(optional)* AST locate + scoped `run_tests` | `ast_grep`, `find_files`, `run_tests` |

```bash
# Default set (4 prompts)
npm run marketing:capture:live
npm run marketing:capture:desktop

# Include optional 5th (slower)
set MARKETING_INCLUDE_OPTIONAL=1
npm run marketing:capture:live

# One prompt (legacy IDs still work)
node scripts/capture-marketing-live.mjs --id live-coding-debounce
node scripts/capture-marketing-desktop.mjs --id desktop-code-ship-test
```

Mirror list in `packages/web/client/marketing/livePrompts.ts`.

---

## Publishing to the marketing website

**Default** — unattended headless capture + sync to sibling `vireondynamics-website`:

```bash
npm run marketing:publish
```

Desktop window assets as well:

```bash
npm run marketing:publish:all
```

Or step by step:

```bash
# 1) Record (unattended — no manual chats)
npm run marketing:capture:unattended

# 2) Copy MP4/PNG/GIF + WebP posters + regenerate gallery TS
cd ../vireondynamics-website && npm run sync-marketing-captures
```

Set `VIREON_WEBSITE_ROOT` if the website repo is not a sibling folder.

**Know when a long capture finishes:**

```bash
# Terminal 1 — run capture
npm run marketing:publish

# Terminal 2 — block until done (exit 0 = success, 1 = failed)
npm run marketing:watch

# One-shot status
npm run marketing:status

# Optional Windows toast + terminal bell when capture scripts finish
set MARKETING_CAPTURE_NOTIFY=1
npm run marketing:publish
```

Progress is also written to `assets/marketing/.capture-status.json`. Capture logs emit a machine-readable line:

`MARKETING_CAPTURE_STATUS=completed exit=0 ok=4 failed=0 summary=...`

**Website gallery:** [vireondynamics.com/liminal/in-action](https://vireondynamics.com/liminal/in-action) — desktop section first, then web captures.

**Also syncs on site build** when liminal repo is present: `npm run sync:liminal` in the website repo.

---

## Publishing checklist

- [ ] Asset produced with `marketing:capture:live`
- [ ] `live-manifest.json` shows `source: "live"` and lists tools actually invoked
- [ ] `recordings/<id>/session.jsonl` exists and matches the screenshot
- [ ] README/website copy does not claim capabilities absent from the tool list

Replace root heroes when live takes are better:

- `assets/web-ui.png` ← e.g. `live-coding-debounce.png`
- `assets/persona-bootstrap.png` ← still best from live bootstrap or a dedicated capture

**Remotion marketing reels** (programmatic 1080p MP4s):

```bash
npm run marketing:video              # Remotion Studio preview
npm run marketing:video:render:all   # export all chapters → assets/marketing/videos/
```

See `packages/marketing-video/README.md`.

**Website gallery (desktop + live):**

```bash
npm run marketing:publish              # capture desktop + sync (liminal-ai root)
# or after captures exist:
cd C:\Users\traid\vireondynamics-website && npm run sync-marketing-captures
```

Publishes to [vireondynamics.com/liminal/in-action](https://vireondynamics.com/liminal/in-action) from `public/marketing/desktop/` and `public/marketing/live/`.
