import React from "react";
import { Box, Text } from "ink";
import type { MessageEntry } from "../useAgent.js";
import { SubtaskCard } from "./SubtaskCard.js";

const TOOL_STATUS: Record<
  string,
  { icon: string; color: "yellow" | "magenta" | "cyan" | "green" | "red" | "white" }
> = {
  streaming:        { icon: "…", color: "yellow" },
  pending_approval: { icon: "⚠", color: "magenta" },
  running:          { icon: "⟳", color: "cyan" },
  done:             { icon: "✓", color: "green" },
  error:            { icon: "✗", color: "red" },
};

/** Pull the most descriptive single arg to show beside the tool name. */
function primaryArg(argsJson: string): string {
  if (!argsJson) return "";
  try {
    const a = JSON.parse(argsJson) as Record<string, unknown>;
    for (const k of ["path", "file_path", "command", "query", "url", "key", "goal", "topic", "pid", "task_id"]) {
      const v = a[k];
      if (typeof v === "string" && v) return v.slice(0, 70);
      if (typeof v === "number") return String(v);
    }
    for (const v of Object.values(a)) {
      if (typeof v === "string" && v) return v.slice(0, 70);
    }
  } catch { /* ignore */ }
  return "";
}

interface Props {
  entry: MessageEntry;
  width: number;
}

export function MessageItem({ entry, width }: Props) {
  const w = Math.max(20, width);

  switch (entry.kind) {
    /* ── User message ───────────────────────────────────── */
    case "user":
      return (
        <Box flexDirection="row" marginTop={1} gap={1} width={w}>
          <Text color="cyan" bold>▶</Text>
          <Box flexGrow={1}>
            <Text color="white" wrap="wrap">
              {entry.text.length > 2000 ? entry.text.slice(0, 2000) + "…" : entry.text}
            </Text>
          </Box>
        </Box>
      );

    /* ── Assistant text ─────────────────────────────────── */
    case "assistant": {
      const text = entry.text.length > 8000 ? entry.text.slice(0, 8000) + "…" : entry.text;
      return (
        <Box width={w} marginBottom={0} paddingLeft={0}>
          <Text color="green" wrap="wrap">
            {text}
            {entry.streaming && <Text color="green">▌</Text>}
          </Text>
        </Box>
      );
    }

    /* ── Trace (provider retries, harness lines) ────────── */
    case "trace": {
      if (!entry.text.trim()) return null;
      const t = entry.text.length > 240 ? entry.text.slice(0, 240) + "…" : entry.text;
      return (
        <Box paddingLeft={2} width={w}>
          <Text dimColor color="gray" wrap="truncate-end">
            ∷ {t.replace(/\n/g, " ")}
          </Text>
        </Box>
      );
    }

    /* ── Tool call ──────────────────────────────────────── */
    case "tool_call": {
      const { icon, color } = TOOL_STATUS[entry.status] ?? { icon: "?", color: "white" as const };
      const arg = primaryArg(entry.argsJson);
      const nameAndArg = arg ? `${entry.name} · ${arg}` : entry.name;
      const maxLabel = Math.max(10, w - 10);
      const label =
        nameAndArg.length > maxLabel ? nameAndArg.slice(0, maxLabel - 1) + "…" : nameAndArg;

      return (
        <Box paddingLeft={2} gap={1} width={w} flexDirection="row">
          <Text color="yellow">⚙</Text>
          <Text color="white">{label}</Text>
          <Text color={color} bold>{icon}</Text>
          {entry.status === "pending_approval" && (
            <Text color="magenta"> — press A to approve / R to reject</Text>
          )}
        </Box>
      );
    }

    /* ── Tool result ────────────────────────────────────── */
    case "tool_result": {
      const raw = entry.output.length > 280 ? entry.output.slice(0, 280) + "…" : entry.output;
      const oneLiner = raw.replace(/\n/g, " ↩ ");
      return (
        <Box paddingLeft={5} width={w}>
          <Text color={entry.ok ? "gray" : "red"} dimColor={entry.ok} wrap="truncate-end">
            └─ {oneLiner}
          </Text>
        </Box>
      );
    }

    /* ── Ask-user (historical in transcript) ────────────── */
    case "ask_user":
      return (
        <Box flexDirection="column" paddingLeft={2} width={w}>
          <Text color="blue" bold>◆ Agent asked:</Text>
          <Box paddingLeft={2}>
            <Text color="white" wrap="wrap">
              {entry.prompt.length > 600 ? entry.prompt.slice(0, 600) + "…" : entry.prompt}
            </Text>
          </Box>
        </Box>
      );

    /* ── Think ──────────────────────────────────────────── */
    case "think": {
      const t = entry.content.length > 500 ? entry.content.slice(0, 500) + "…" : entry.content;
      return (
        <Box paddingLeft={2} width={w}>
          <Text color="magenta" dimColor wrap="wrap">
            ◈ {t}
          </Text>
        </Box>
      );
    }

    /* ── Plan ───────────────────────────────────────────── */
    case "plan":
      if (!entry.steps.length) return null;
      return (
        <Box flexDirection="column" paddingLeft={2} width={w}>
          <Text color="cyan" bold>▸ Plan</Text>
          {entry.steps.map((step, i) => {
            const done = step.startsWith("✓");
            return (
              <Box key={i} paddingLeft={2}>
                <Text color={done ? "green" : "gray"}>
                  {i + 1}. {step}
                </Text>
              </Box>
            );
          })}
        </Box>
      );

    /* ── Sub-agent ──────────────────────────────────────── */
    case "subtask":
      return (
        <Box width={w}>
          <SubtaskCard
            taskId={entry.taskId}
            goal={entry.goal}
            depth={entry.depth}
            status={entry.status}
            partialOutput={entry.partialOutput}
          />
        </Box>
      );

    /* ── Context compressed notice ──────────────────────── */
    case "context_compressed":
      return (
        <Box paddingLeft={2} width={w}>
          <Text color="yellow" dimColor>
            {"⊙ Context compressed "}
            {entry.beforePct}{"% → "}
            {entry.afterPct}{"% ("}
            {entry.rounds}
            {" round"}
            {entry.rounds !== 1 ? "s" : ""}
            {" summarised)"}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}
