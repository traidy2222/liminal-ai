# Compose dock & file attachments

The web and desktop shells show a **right-hand compose dock** when the agent edits files or drafts email. You can also attach **any file type** to the chat composer (not only images).

## Compose dock

When the harness streams a compose-related tool, the UI opens the dock immediately:

| Trigger | Dock shows |
| ------- | ---------- |
| `write_file` / `edit_file` | Live file content (`compose_preview` + `tool_delta`) |
| `gmail_*` / `outlook_*` compose | HTML or plain email preview |
| Streaming | Content updates until `tool_result`; panel can persist through `turn_end` |

Email HTML is sanitized the same way as send path (extract `<body>`, no raw monospace HTML dump).

Implementation:

- Web: compose rail in `packages/web/client/`
- Desktop: compose dock in `apps/liminal_desktop/lib/ui/`

See [Rich message rendering](../concepts/rich-message-rendering.md) for assistant-side HTML/markdown (separate from the compose dock).

## Chat file attachments

Drag, drop, or paste files into the **message composer** on web and desktop. Attachments are persisted under:

```text
<workspace>/.agent_artifacts/uploads/
```

The agent receives paths it can pass to `read_file`, vision tools (images), or email attach fields.

### Limits (defaults)

From `DEFAULT_CHAT_ATTACHMENT_LIMITS` in `packages/core/src/chat_attachments.ts`:

| Limit | Value |
| ----- | ----- |
| Max images | 4 |
| Max non-image files | 8 |
| Max total attachments | 12 |
| Max image size | 4 MB each |
| Max file size | 25 MB each |
| Max total payload | 64 MB |

Images may also flow through the vision path (` ```attached_images` block). Non-image files are referenced by workspace path in the user turn.

### Wire protocol

- **Web:** `POST /api/message` with `attachments[]` (data URLs). See [Web API](../reference/web-api.md).
- **Desktop:** `send_message` over `@liminal/protocol` WebSocket with the same attachment shape.

Audio clips use a separate upload path — see [Voice](./voice.md).

## Receipt workflow

The inbox watcher can persist receipt attachments from mail into the workspace for bookkeeping flows (`packages/core/src/receipt_workflow.ts`). See [Inbox watcher](./inbox-watcher.md).

## Related

- [UI streaming](../concepts/ui-streaming.md)
- [Google Workspace — Rich email](./google-workspace.md)
- [Multi-account mail](./multi-account-mail.md)
