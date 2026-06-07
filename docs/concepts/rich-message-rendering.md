# Rich message rendering

Contract between the Liminal harness (what the model may emit) and each UI shell (what users actually see).

## Harness output

The harness streams assistant text on the `text` channel (`channel: "assistant"`). The system prompt ([`packages/tools/src/systemPrompt.ts`](../../packages/tools/src/systemPrompt.ts)) encourages:

| Format | Use case |
|--------|----------|
| **GFM markdown** | Prose, tables, task lists, `> [!NOTE]` callouts, fenced code |
| **Raw HTML** | Gradient cards, flex layouts, KPI blocks, “Bottom line” panels |
| **` ```html ` fences** | Same as raw HTML; preferred for large blocks; **streams live** on web/desktop |
| **Images** | `![](https://…)` or `data:image/…` |
| **Video** | Bare YouTube/Vimeo URLs or links |
| **User attachments** | ` ```attached_images` block (vision workflow) |

Tool rows, harness trace, and working-state snapshots are **not** rich-rendered.

**Persistent desktop widgets** (weather panels, calculators, live dashboards) are **not** chat HTML — the agent uses `spawn_app` and separate OS windows. See [Liminal desktop apps](./liminal-apps.md).

## Web UI (reference)

Implementation: [`packages/web/client/liminalMarkdown.tsx`](../../packages/web/client/liminalMarkdown.tsx), [`App.tsx`](../../packages/web/client/App.tsx) assistant case.

- GFM via `remark-gfm`
- Inline HTML via `rehype-raw` + `rehype-sanitize`
- Fenced HTML via `HtmlEmbedBlock` + streaming fence split (`liminalMarkdownUtils.ts`)
- Prism for code fences; `html`/`htm`/`xhtml` fences → live HTML
- Custom `img`, YouTube/Vimeo iframes, alert blockquotes

## Desktop UI

Implementation: [`apps/liminal_desktop/lib/ui/rich_message/`](../../apps/liminal_desktop/lib/ui/rich_message/).

| Capability | Desktop |
|------------|---------|
| GFM | `flutter_markdown` + `ExtensionSet.gitHubWeb` |
| Fenced HTML | `HtmlEmbedView` (WebView, JS off, sanitized) |
| Inline HTML | `flutter_widget_from_html` (sanitized) |
| Code fences | `flutter_highlight` (non-html langs) |
| Images | `https:`, `data:image/*`, workspace `/media?path=` |
| Video | YouTube/Vimeo embed WebView |
| User image attach | `send_message.attachments` → same wire block as web |
| Streaming HTML fence | Dart port of `extractStreamingHtmlFence` |

## Security

- No arbitrary JavaScript in assistant HTML embeds
- Block `file://`, `javascript:`, `blob:` in untrusted URLs
- Workspace media only via sidecar `GET /media` (path under chat workspace root, token-gated)
- Size caps aligned with [`DEFAULT_IMAGE_ATTACHMENT_LIMITS`](../../packages/core/src/image_attachments.ts)

## Versioning

Render contract changes should update this doc and keep web + desktop in sync. Shared TS utils live in `liminalMarkdownUtils.ts`; Dart port in `liminal_markdown_utils.dart`.
