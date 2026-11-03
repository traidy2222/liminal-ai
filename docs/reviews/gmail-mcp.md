# Gmail MCP review and repair

## What failed

The user's session contained five failed `mcp_google_gmail_create_label` calls reporting a missing `displayName`. The compatibility layer had removed that field before validation. Google declares it as the required label name; the account and server were working.

Live `list_labels`, `search_threads` and `get_thread` calls succeeded. Fresh discovery returned the same 23 Gmail tools as the saved connection. The separate trash-message 404 used an ID absent from the earlier search results; it was not evidence of an OAuth failure.

## Comparison with other clients

| Client | Documented behavior | Implication for Liminal |
| --- | --- | --- |
| [Claude Gmail connector](https://claude.com/marketplace/connectors/gmail) | Uses `https://gmailmcp.googleapis.com/mcp/v1`, with search, read, draft and mailbox-management tools. | We already use the same endpoint. Fix our adapter rather than replacing a working provider. Capabilities must follow live discovery, not a hardcoded catalog. |
| [Claude Code](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) | Defers MCP definitions and discovers them on demand; server instructions explain when to use tools. | Keep our lazy integration families, with concise, accurate descriptions and canonical schemas. |
| [Cursor](https://prod.cursor.com/docs/mcp) | Discovers server tools, supports enabling/disabling them and applies tool approval policy. | Preserve provider fields and correctly classify mailbox mutations. |
| [OpenCode](https://opencode.ai/v2/docs/mcp-servers) | Supports remote MCP/OAuth, per-server tools and permission controls; separate account connections use distinct names. | Keep account boundaries explicit and honor read-only selection. |

Google documents [`search_threads`](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/search_threads) for summaries and [`get_thread`](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/get_thread) for full message content. Its [`create_draft`](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/create_draft) schema supports `htmlBody` and `replyToMessageId`. Attachments are not supported by that MCP draft method; our REST/MIME helper remains useful for those.

## Changes

- Preserve every declared remote field, including `displayName`, `text` and native snake_case fields. A valid server field cannot be stripped because another tool uses that spelling as an alias.
- Expose canonical schemas to models. Resolve compatibility aliases only against the current tool's schema before validation; do not duplicate long parameter descriptions into synthetic fields.
- Retain JSON Schema integer types and fractional number values. The dispatcher already understands both.
- Recognize the official MCP reply field and remove obsolete claims that MCP drafts are plain-text only. Plain-text drafts remain valid without decorative HTML; factual-content and approval checks remain in place. REST helpers remain available for account-specific compose, attachments and sending saved drafts.
- Treat trash, spam, reply and forward actions as writes, including in read-only filtering and restoration of older saved connections. Copy exact IDs from the bound mailbox's search/read results; a 404 now requests refreshed IDs rather than returning Google's backend stack trace.
- Fetch Gmail reads freshly. A dispatcher regression showed that the old 30-second cache hid a newly created label from the next read; caching could also outlive a rebound account connection.

## Verification

- Reproduced schema, draft, permission and stale-read failures, then 47 focused checks passed. Workspace build and typecheck passed.
- Live Gmail search and thread reads passed without printing message contents.
- The old dispatcher failed a label request before network access. The repaired dispatcher created one uniquely named empty label through its approval gate; the test then deleted that exact label. No messages were changed or sent.
- For the account's 23 discovered Gmail tools, parameter definitions decreased from 96 fields / 85,040 characters to the server's 53 fields / 27,241 characters: 68% fewer schema characters. This is measured schema overhead, not a measured first-token latency claim.

Outbound sends are validated with local fixtures, not test emails to other people. This review does not claim that unavailable tools from another account's catalog are available here.

## Independent review

| Finding | Resolution |
| --- | --- |
| [4449743058](https://github.com/traidy2222/liminal-ai/pull/12#discussion_r4449743058) | Integer union branches now recognize coerced integer numbers. The regression checks numeric-string preparation through the dispatcher pipeline. |
| [4449743069](https://github.com/traidy2222/liminal-ai/pull/12#discussion_r4449743069) | Already addressed by restricting message-ID recovery to schemas declaring message/thread targets; the label-error boundary has a regression. |
| [4449743075](https://github.com/traidy2222/liminal-ai/pull/12#discussion_r4449743075) | Normalize underscore-form descriptions before classifying unknown operations, preserving write approval. |
| [4449743085](https://github.com/traidy2222/liminal-ai/pull/12#discussion_r4449743085) | Distinguish read-resource nouns from compound actions such as get_or_create and get_and_delete. |
| [4449850776](https://github.com/traidy2222/liminal-ai/pull/12#discussion_r4449850776) | Disable caching for the official Gmail endpoint even when the saved connection has a custom name. A dispatcher regression covers list, mutate, list on both default and custom names. |

The first three actionable findings have separate bounded review ledgers with unchanged regressions checked against the same repair snapshot: `1793669027268-c50d1c13`, `1793669196602-6cccdb57`, and `1793669198295-a0bf323b`. The custom-name cache regression is recorded in `1793669705578-11c4c5d6`. These record local verification; the combined focused tests and final CI cover subsequent changes before merging.
