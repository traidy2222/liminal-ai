/** Coerce Slack message timestamps (models often pass JSON numbers). */
function slackTs(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  const s = String(val).trim();
  return s || undefined;
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Model-friendly arg normalization for slack_* tools (runs before JSON-schema validation).
 */
export function normalizeSlackRestToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!name.startsWith("slack_")) return args;

  const out = { ...args };

  if (name === "slack_search_messages") {
    if (out["limit"] !== undefined && out["count"] === undefined) {
      out["count"] = out["limit"];
      delete out["limit"];
    }
  }

  if (name === "slack_get_channel_history" || name === "slack_get_thread_replies") {
    if (out["count"] !== undefined && out["limit"] === undefined) {
      out["limit"] = out["count"];
      delete out["count"];
    }
  }

  if (name === "slack_get_thread_replies" || name === "slack_reply_in_thread") {
    const ts = slackTs(out["thread_ts"]) ?? slackTs(out["ts"]);
    if (ts) out["thread_ts"] = ts;
    delete out["ts"];
  }

  if (name === "slack_add_reaction") {
    const ts =
      slackTs(out["timestamp"]) ?? slackTs(out["ts"]) ?? slackTs(out["message_ts"]);
    if (ts) out["timestamp"] = ts;
    delete out["ts"];
    delete out["message_ts"];
  }

  if (name === "slack_post_message") {
    const ts = slackTs(out["thread_ts"]) ?? slackTs(out["ts"]);
    if (ts) out["thread_ts"] = ts;
    delete out["ts"];
  }

  if (name === "slack_upload_file") {
    const channel =
      firstString(out, ["channel", "channels", "channel_id"]) ??
      (typeof out["channels"] === "string" ? out["channels"].trim() : undefined);
    if (channel) out["channel"] = channel;
    delete out["channels"];
    delete out["channel_id"];
    if (!out["content"] && out["file_content"] !== undefined) {
      out["content"] = out["file_content"];
      delete out["file_content"];
    }
    if (!out["content"] && out["text"] !== undefined) {
      out["content"] = out["text"];
      delete out["text"];
    }
  }

  if (name === "slack_open_dm") {
    const user = firstString(out, ["user", "user_id", "users"]);
    if (user) out["user"] = user;
    delete out["user_id"];
    delete out["users"];
  }

  return out;
}
