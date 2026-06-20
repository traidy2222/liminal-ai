# Multi-account mail

When more than one **Gmail** or **Microsoft 365** mailbox is connected, Liminal must know which account owns a thread before it drafts or sends. v0.1.2 added first-class multi-mailbox support across search, compose, and session memory.

## Connected mail only

`mail_oauth_filter` and `list_connectors` expose **Connected mailboxes**: accounts with mail OAuth scopes that are actually linked in Integrations. The harness ignores:

- Providers you have not connected
- Entra `#EXT#` guest admin mailboxes that are not the user's primary mail

Rule **R-EMAIL-ACCOUNT** tells the model to call `mail_search_inboxes` before probing MCP or REST on unconnected providers.

## Scan all inboxes

`mail_search_inboxes` searches every connected Gmail/Outlook account in one call. Use it for:

- "What needs a reply today across all mailboxes?"
- Finding which account received a thread before composing a reply
- Inbox triage before the [Inbox watcher](./inbox-watcher.md) labels mail

### Privacy redaction

By default `redact_sensitive: true` masks SSNs, card numbers, phones, and addresses in snippets returned to the model. Rule **R-EMAIL-PRIVACY** applies when the user asks to summarize mail without leaking secrets.

The operator can set `redact_sensitive: false` for full bodies when appropriate (trusted environment only).

Implementation: `packages/core/src/email_redaction.ts`.

## Replying from the correct mailbox

When multiple accounts are connected, compose and send tools require **`account_hint`**: the mailbox email or account id from `mail_search_inboxes` / thread metadata.

| Tool | `account_hint` |
| ---- | -------------- |
| `gmail_create_draft` | Required when >1 Gmail account |
| `gmail_send_message` | Required when >1 Gmail account |
| `gmail_send_draft` | Use draft from the same account |
| Outlook REST compose/send | Same pattern for Microsoft |

Session state: successful `mail_search_inboxes` hits update **`mail_account_context`** so the next turn remembers the mailbox + `threadId` / `messageId` without re-explaining.

## Recommended agent flow

1. `mail_search_inboxes` (with `redact_sensitive` as needed)
2. Pick the row for the thread you will answer
3. `gmail_create_draft` or `gmail_send_message` with `account_hint` + `thread_id` from that row
4. User approves send

For styled HTML outbound mail, prefer **REST** `gmail_create_draft` / `gmail_send_message`, not plain MCP draft tools. See [Google Workspace — Rich email](./google-workspace.md).

## UI

- **Integrations** shows each connected mailbox per provider.
- **Revoke** removes one account via `revoke_integration_account` without disconnecting sibling accounts.

## Related

- [Connectors & Integrations hub](./connectors.md)
- [Google Workspace](./google-workspace.md)
- [Microsoft 365](./microsoft-365.md)
- [Inbox watcher](./inbox-watcher.md)
- [Compose dock & attachments](./compose-dock-and-attachments.md)
