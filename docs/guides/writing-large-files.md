# Writing large files

Liminal writes files through tools — not by pasting megabytes into chat. Very long single tool arguments are often cut off by **provider output limits** or **streaming timeouts**, which produces incomplete files that still report success.

## Recommended workflow

| Step | Tool | Notes |
|------|------|--------|
| 1 | `write_file` | **Create-only** — one call per path for the first section (~≤1000 lines ideal). |
| 2 | `append_file` | Add follow-up sections to the same path. |
| 2 (alt) | `write_file_part` | Stage `part_index` 0,1,2… then `finalize:true` (copy `session_id` from part 0). |
| 3 | `file_metadata` | Confirm line count / hash before telling the user you're done. |

For **edits** to existing files, prefer `edit_file` (replacements or diff hunks) instead of rewriting the whole file.

## Harness settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_LENGTH_RESUME_MAX` | `3` | Auto-continue when output or file-write tool JSON is truncated |
| `AGENT_MAX_COMPLETION_TOKENS` | `0` (omit) | Set e.g. `16384` to raise main completion cap (provider may still limit lower) |
| `AGENT_WRITE_INTEGRITY_NUDGE` | `1` | System note when a write reports `likely_truncated=true` |
| `AGENT_WRITE_PART_MAX_CHARS` | `512000` | Max size per `write_file_part` chunk |
| `AGENT_WRITE_STREAM_SINK` | `1` | Stream `content` to disk while tool args arrive (keeps partial bytes on cutoff) |
| `AGENT_WRITE_STREAM_SINK_MIN_CHARS` | `8000` | Only use stream sink above this estimated size |

## Stream sink (partial saves)

When `AGENT_WRITE_STREAM_SINK=1` and a large `write_file` / `append_file` payload is streaming, the harness writes decoded text to `.agent_write_staging/inflight/` as it arrives. If the provider cuts off:

- Truncated tool JSON triggers **length resume** (no bogus “verified” write).
- Bytes already streamed may be **salvaged to the target path** so you can continue with `append_file`.

Truncated content that still parses as JSON is **rejected** (`ok: false`) with `Refusing write: content looks truncated…`.

## Tool output signals

File writes include an integrity footer, for example:

```text
integrity=ok lines=1204 bytes=48210 sha256=abc123…
```

If you see `likely_truncated=true` or `integrity=mismatch`, **do not** treat the file as complete — use `append_file` or another part, then verify with `file_metadata`.

## What not to do

- Call `write_file` twice on the same path (the second call fails — file already exists).
- Rely on a single 3000+ line `write_file` in one tool call.
- Ignore `likely_truncated` because the tool returned `ok: true`.

See also [Troubleshooting — file ends abruptly](../operations/troubleshooting.md).
