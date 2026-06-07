# Web research

Liminal researches the public web with **`web_search` plus parallel `web_fetch`** — there is
no separate `web_research` tool. The model composes a search with several fetches, which maps
cleanly onto "gather N sources, compare claims."

## The retrieval order

For knowledge tasks the protocol enforces an order so the agent doesn't skip what it already
knows:

1. `memory_query` / `recall_relevant` — your own notes.
2. `vault_search` / `vault_read` — your long-form knowledge.
3. `web_search` + parallel `web_fetch` — only when local knowledge is insufficient.

See [Memory &amp; recall](./memory-and-recall.md) for the first two layers.

## Tools

| Tool | Purpose |
| ---- | ------- |
| `web_search` | Find candidate sources for a query |
| `web_fetch` | Fetch + extract a page (readability when `AGENT_WEB_READABILITY` is on) |
| `http_request` | Raw HTTP when you need headers/JSON, not article extraction |
| `extract_structured` | Pull structured JSON out of messy HTML/text |

Run multiple `web_fetch` calls in parallel for breadth. Large bodies are distilled to
`.agent_artifacts/` pointers in context — the model re-reads via `read_artifact` instead of
repeating megabytes each round.

## Search provider (`web_search`)

By default `web_search` uses **DuckDuckGo** HTML results (no API key). For **Google organic**
results, switch to [Serper](https://serper.dev) in Settings or `.env`:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_WEB_SEARCH_PROVIDER` | `duckduckgo` | `duckduckgo` \| `serper` |
| `AGENT_SERPER_API_KEY` | — | Serper API key (**secret** — `.env` only, never Settings prefs) |
| `AGENT_SERPER_GL` | `us` | Serper country code (`gl`) |
| `AGENT_SERPER_HL` | `en` | Serper language (`hl`) |
| `AGENT_WEB_SEARCH_FALLBACK` | on | When Serper fails, retry once via DuckDuckGo |

With `AGENT_WEB_SEARCH_PROVIDER=serper` and a valid `AGENT_SERPER_API_KEY`, queries bill against
your Serper account. If Serper returns auth/quota/network errors and fallback is on, the harness
annotates the tool output (`Serper failed …; fell back to DuckDuckGo.`) and returns DDG hits.

## Fetch provider (`web_fetch`)

When `AGENT_SERPER_API_KEY` is set and `AGENT_WEB_FETCH_SERPER=1` (default), `web_fetch` tries
[Serper scrape](https://serper.dev) (`POST https://scrape.serper.dev`) before the local
HTTP + Readability path. This bills Serper credits per page (typically more than a search).
On auth, quota, rate-limit, or empty responses, the harness **falls back** to the normal local
fetch (timeouts, bot-wall retries, PDF parse, Wikipedia shortcuts, etc.).

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_WEB_FETCH_SERPER` | on | Try Serper scrape when the API key is set (`0` = local only) |

`include_assets=true` always uses the local path (Serper does not return HTML for link/image
discovery). Wikipedia `/wiki/` shortcuts and direct PDF/image URLs also stay on the local path.

## Bot walls &amp; reliability

`web_fetch` has per-request and total wall-clock timeouts and retries behind bot walls. When a
site returns a 401/403, `AGENT_WEB_FETCH_403_RETRY` retries with alternate (Firefox /
cross-site Chrome) user agents. For pages that need JavaScript execution or a logged-in
session, use [browser automation](./browser-automation.md) instead of `web_fetch`.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_WEB_READABILITY` | on | Article extraction in `web_fetch` |
| `AGENT_WEB_FETCH_TIMEOUT_MS` | `20000` | Per-request timeout |
| `AGENT_WEB_FETCH_TOTAL_WALL_MS` | `55000` | Hard wall clock per call (all retries + parse) |
| `AGENT_WEB_FETCH_403_RETRY` | on | Alternate-UA retry after a bot-wall 401/403 |
| `AGENT_QUERY_REWRITE` | off | Multi-query expansion before recall |

## Research at scale

For multi-angle or multi-source research, fan out:

- `spawn_agent` per angle ("only fetch official docs", "only GitHub issues") — see
  [Sub-agents &amp; orchestration](./sub-agents-and-orchestration.md).
- A [dynamic workflow](./dynamic-workflows.md) with phases (sources → analysis → synthesis)
  when the classifier marks the task `workflowSuitable`.
- `research_state` tracks the research ledger so long investigations stay disciplined.

## Keeping results

Write durable findings down: short claims via `remember({ scope: "workspace" })`, long briefs
via `vault_write` with `[[wikilinks]]`. The [document engine](./document-engine.md) can compile
a report into PPTX/DOCX/PDF when `AGENT_DOC_ENGINE` is on. Set `AGENT_EFFORT=high` for thorough
deliverables — see [Reasoning &amp; effort](./reasoning-and-effort.md).
