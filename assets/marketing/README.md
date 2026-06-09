# Liminal marketing captures

## Two modes (read this)

| Mode | Command | Accurate? |
|------|---------|-----------|
| **Desktop (primary for desktop marketing)** | `npm run marketing:capture:desktop` | **Yes** — real harness via `liminald`, real Flutter window capture |
| **Live web (CLI/web marketing)** | `npm run marketing:capture:live` | **Yes** — real harness, real tools, session JSONL |
| **Illustrative fixtures** | `npm run marketing:capture` | **No** — hand-drawn UI states for layout only |

The PNGs/GIFs already in this folder from `marketing:capture` are **staged examples**, not recordings of the model executing those prompts. Do not ship them as proof of capability without running live capture.

---

## Desktop capture (accurate · 1:1 with shipped app)

**Requires:** `AGENT_API_KEY` in `.env`, built desktop (`npm run desktop:build:windows`), Windows for window capture, FFmpeg on PATH.

Captures pin **`openrouter/owl-alpha`** (OpenRouter Stealth) automatically. Override: `MARKETING_AGENT_MODEL=…` or disable: `MARKETING_SKIP_MODEL=1`.

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

**Requires:** `AGENT_API_KEY` in `.env`, web stack running. Model pinned to **`openrouter/owl-alpha`** (see desktop section for overrides).

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

**Website gallery (live GIFs only):**

```bash
npm run marketing:capture:live   # repo root (liminal-ai)
cd C:\Users\traid\vireondynamics-website && npm run sync-marketing-live
```

Publishes to [vireondynamics.com/liminal/in-action](https://vireondynamics.com/liminal/in-action) from `vireondynamics-website/public/marketing/live/*.gif` (synced on site build).
