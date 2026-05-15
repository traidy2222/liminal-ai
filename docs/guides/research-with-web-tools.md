# Research with web tools

Liminal does **not** ship a single `web_research` tool. Multi-source research uses **`web_search`** plus selective **`web_fetch`** calls (often in parallel in one model round).

The eval scenario `web_research_quality` still tests this **behavior** — not a removed tool name.

## Recommended flow

1. **Diversify queries** — Run 2–4 `web_search` calls with different angles (background, latest status, impact). The harness blocks near-duplicate first-pass queries when research rules apply.
2. **Pick URLs** — From snippets, choose a small set of high-signal links (3–4 substantive sources per angle is enough; see `R-RESEARCH-BUDGET` in [Harness protocol](../concepts/harness-protocol.md)).
3. **`web_fetch`** — Fetch article text. Each call has a **hard wall** (`AGENT_WEB_FETCH_TOTAL_WALL_MS`, default 55s). Avoid many parallel fetches to slow news sites in one turn.
4. **Synthesize** — Answer with timeline, sources, uncertainty, and open questions. See [Research quality](./research-quality.md).

## Readability and timeouts

With `AGENT_WEB_READABILITY=1`, `web_fetch` runs Mozilla Readability in a **worker thread** so huge HTML cannot block the Node event loop. Caps: `AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS`, `AGENT_WEB_FETCH_READABILITY_MS`, preprocess truncation.

Full flag list: [Configuration — Web and fetch](../configuration.md#web-and-fetch).

## `read_artifact` vs inline output

`read_artifact` only works when **`AGENT_DISTILL=1`** or **`AGENT_TOOL_BODY_ELIDE=1`** stored a hash under `.agent_artifacts/`. If both are off, use the **inline** `web_fetch` result in the tool trace — do not call `read_artifact` on guessed hashes.

## When fetch fails

- **403 / bot wall** — Alt User-Agent retries (disable with `AGENT_WEB_FETCH_403_RETRY=0`), optional `AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE`, or `browser_open` / `browser_act`.
- **404** — Bad or moved URL; try another source from search results.
- **Stuck UI** — Rebuild `core`/`tools`, restart web; see [Troubleshooting — web_fetch](../operations/troubleshooting.md).

## Persisting results

For durable briefs, use **`vault_write`** (not `remember` alone). See [Vault briefs and updates](./vault-briefs-and-updates.md).
