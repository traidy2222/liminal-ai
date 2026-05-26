/**
 * Convert `~/.liminal/chats/<chatId>/session.jsonl` → UI message entries for marketing replay.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const T0 = Date.now();

/**
 * @param {string} jsonlPath
 * @param {string} [promptHint] — if set, only include events from the last matching send_start turn
 */
export async function messagesFromSessionJsonl(jsonlPath, promptHint = "") {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const records = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

  let startIdx = 0;
  if (promptHint) {
    const hint = promptHint.slice(0, 48).toLowerCase();
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.event === "send_start" && String(r.userMessage ?? "").toLowerCase().includes(hint.slice(0, 24))) {
        startIdx = i;
        break;
      }
    }
  }

  const slice = records.slice(startIdx);
  /** @type {object[]} */
  const messages = [];
  /** @type {Map<string, object>} */
  const openTools = new Map();
  let turnIndex = 0;
  let durationMs;
  const tools = new Set();
  let offset = 0;

  for (const row of slice) {
    const ev = row.event;
    if (ev === "send_start") {
      turnIndex = row.turnIndex ?? turnIndex + 1;
      const text = String(row.userMessage ?? "").trim();
      if (text && text !== "(session greeting)") messages.push({ kind: "user", text });
      offset += 40;
      continue;
    }
    if (ev === "tool_start") {
      const callId = String(row.callId ?? `call-${offset}`);
      const name = String(row.name ?? "tool");
      tools.add(name);
      const startedAt = T0 + offset;
      offset += 80;
      const entry = {
        kind: "tool_call",
        callId,
        name,
        argsJson: row.args != null ? JSON.stringify(row.args).slice(0, 2000) : "",
        status: "running",
        startedAt,
      };
      openTools.set(callId, entry);
      messages.push(entry);
      continue;
    }
    if (ev === "tool_result") {
      const callId = String(row.callId ?? "");
      const name = String(row.name ?? "tool");
      tools.add(name);
      const existing = openTools.get(callId);
      const startedAt = existing?.startedAt ?? T0 + offset;
      offset += 100;
      const argsJson =
        row.args != null ? JSON.stringify(row.args).slice(0, 2000) : existing?.argsJson ?? "";
      if (existing) {
        const idx = messages.indexOf(existing);
        if (idx >= 0) {
          messages[idx] = {
            ...existing,
            argsJson,
            status: row.ok === false ? "error" : "done",
            endedAt: startedAt + 1200,
          };
        }
        openTools.delete(callId);
      } else {
        messages.push({
          kind: "tool_call",
          callId,
          name,
          argsJson,
          status: row.ok === false ? "error" : "done",
          startedAt,
          endedAt: startedAt + 1200,
        });
      }
      const output = String(row.output ?? row.error ?? "").trim();
      if (output) {
        messages.push({
          kind: "tool_result",
          callId,
          ok: row.ok !== false,
          output: output.slice(0, 4000),
        });
      }
      if (name === "think" && row.args && typeof row.args.content === "string") {
        messages.push({ kind: "think", content: row.args.content });
      }
      if (name === "reason" && row.args && typeof row.args.inference === "string") {
        messages.push({ kind: "reason", inference: row.args.inference });
      }
      if (name === "plan" && row.args && Array.isArray(row.args.steps)) {
        messages.push({ kind: "plan", steps: row.args.steps.map(String) });
      }
      continue;
    }
    if (ev === "text_rollup" || ev === "text_rollup_partial") {
      const text = String(row.text ?? "").trim();
      if (text) messages.push({ kind: "assistant", text, streaming: false });
      continue;
    }
    if (ev === "turn_end") {
      durationMs = row.durationMs;
      continue;
    }
    if (ev === "error") {
      messages.push({
        kind: "assistant",
        text: `[Turn error] ${String(row.message ?? "unknown")}`,
        streaming: false,
      });
    }
  }

  for (const entry of openTools.values()) {
    const idx = messages.indexOf(entry);
    if (idx >= 0) {
      messages[idx] = { ...entry, status: "error", endedAt: entry.startedAt + 1200 };
      messages.push({
        kind: "tool_result",
        callId: entry.callId,
        ok: false,
        output: "Turn ended before tool result was logged.",
      });
    }
  }

  return {
    messages,
    meta: { turnIndex, tools: [...tools], durationMs },
  };
}

/**
 * @param {string} chatId
 */
export async function resolveSessionJsonlPath(chatId) {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const home = os.homedir();
  const candidates = [
    path.join(home, ".liminal", "chats", chatId, "session.jsonl"),
    path.join(home, ".liminal", "chats", safe, "session.jsonl"),
    path.join(process.cwd(), ".agent_sessions", `${safe}.jsonl`),
    path.join(process.cwd(), ".agent_sessions", `${chatId}.jsonl`),
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}
