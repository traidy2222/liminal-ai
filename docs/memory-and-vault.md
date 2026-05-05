# Memory and Vault

Liminal uses two persistent channels:

- compact typed notes (`remember`)
- rich markdown knowledge (`vault_*`)

## Typed Memory

`remember` supports typed entries:

- `fact`
- `entity`
- `experience`
- `belief`
- `reflection`
- `recipe`

Retrieval tools include exact/type/lexical/hybrid/graph paths (`memory_query`, `recall_relevant`, etc.).

## Vault Model

Vault tools manage Obsidian-compatible markdown with frontmatter and wikilinks:

- `vault_search`
- `vault_read`
- `vault_write`
- `vault_list`, `vault_links`, `vault_graph`, `vault_delete`

Set `AGENT_VAULT_PATH` to your real vault path to avoid writing to fallback locations.

## Retrieval Order

Recommended order for factual tasks:

1. memory
2. vault
3. web

Default policy is advisory. Strict pre-web blocking is opt-in via `AGENT_VAULT_FIRST_STRICT=1`.

## Auto-Write Semantics

`AGENT_VAULT_AUTO_WRITE` modes:

- `off` (disabled)
- `research` (default behavior when unset): persist durable research-style learnings
- `aggressive` (broader write behavior)

Deduplication is default-on unless `AGENT_VAULT_DEDUPE=0`.

## Growth vs Noise Tradeoff

Auto-write improves long-horizon knowledge reuse but can increase note churn. Use:

- dedupe
- write budgets
- note typing/tags
- periodic consolidation

to keep the vault high-signal.

## Operational Tips

- prefer durable facts and synthesis, not raw transcript dumps
- keep note titles canonical for linkability
- include uncertainty markers for rapidly changing topics
- keep manual curation loops for mission-critical domains