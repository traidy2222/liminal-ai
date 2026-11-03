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
- Treat trash, spam, reply and forward actions as writes, including in read-only filtering. Copy exact IDs from the bound mailbox's search/read results; a 404 now requests refreshed IDs rather than returning Google's backend stack trace.

## Verification

- Reproduced schema, draft and permission failures, then 41 focused checks passed. Workspace build and typecheck passed.
- Live Gmail search and thread reads passed without printing message contents.
- The old dispatcher failed a label request before network access. The repaired dispatcher created one uniquely named empty label through its approval gate; the test then deleted that exact label. No messages were changed or sent.
- For the account's 23 discovered Gmail tools, parameter definitions decreased from 96 fields / 85,040 characters to the server's 53 fields / 27,241 characters: 68% fewer schema characters. This is measured schema overhead, not a measured first-token latency claim.

Outbound sends are validated with local fixtures, not test emails to other people. This review does not claim that unavailable tools from another account's catalog are available here.
