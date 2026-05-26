# Liminal marketing captures

## Two modes (read this)

| Mode | Command | Accurate? |
|------|---------|-----------|
| **Live (use for website/README)** | `npm run marketing:capture:live` | **Yes** — real harness, real tools, session JSONL |
| **Illustrative fixtures** | `npm run marketing:capture` | **No** — hand-drawn UI states for layout only |

The PNGs/GIFs already in this folder from `marketing:capture` are **staged examples**, not recordings of the model executing those prompts. Do not ship them as proof of capability without running live capture.

---

## Live capture (accurate)

**Requires:** `AGENT_API_KEY` in `.env`, web stack running.

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

`http://localhost:5173/marketing.html?recording=live-coding-debounce`

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

## Suggested live prompts

Defined in `scripts/capture-marketing-live.mjs` and `packages/web/client/marketing/livePrompts.ts`:

1. **live-coding-debounce** — write + `tsc` in `marketing-capture/`
2. **live-repo-grep** — find `AgentHarness`, summarize loop (read-only)
3. **live-web-research** — search + fetch OpenRouter caching docs
4. **live-git-status** — `git_status` + diff stat summary

Add harder live prompts only after you confirm they complete reliably in your environment (browser, doc engine, rename_symbol, etc.).

---

## Publishing checklist

- [ ] Asset produced with `marketing:capture:live`
- [ ] `live-manifest.json` shows `source: "live"` and lists tools actually invoked
- [ ] `recordings/<id>/session.jsonl` exists and matches the screenshot
- [ ] README/website copy does not claim capabilities absent from the tool list

Replace root heroes when live takes are better:

- `assets/web-ui.png` ← e.g. `live-coding-debounce.png`
- `assets/persona-bootstrap.png` ← still best from live bootstrap or a dedicated capture

**Website gallery (live GIFs only):**

```bash
npm run marketing:capture:live   # repo root
cd website && npm run sync-marketing-live
```

Publishes to [vireondynamics.com/liminal/in-action](https://vireondynamics.com/liminal/in-action) from `website/public/marketing/live/*.gif` (synced on `website` build).
