import React from "react";
import { Box, Text } from "ink";
import type { MessageEntry } from "../useAgent.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { SubtaskCard } from "./SubtaskCard.js";

const MAX_RESULT_LINES = 8;
const MAX_RESULT_LINE_LEN = 180;

function renderToolResult(output: string, ok: boolean, w: number): React.ReactElement {
  const lines = output.split("\n");
  const shown = lines.slice(0, MAX_RESULT_LINES);
  const remaining = lines.length - MAX_RESULT_LINES;
  const maxLen = Math.max(20, w - 8);

  return (
    <Box paddingLeft={3} flexDirection="column">
      {shown.map((line, i) => {
        const truncated =
          line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;
        return (
          <Box key={i}>
            <Text
              color={ok ? "gray" : "red"}
              dimColor={ok}
              wrap="truncate-end"
            >
              {i === 0 ? "└ " : "  "}
              {truncated || " "}
            </Text>
          </Box>
        );
      })}
      {remaining > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor color="gray">
            … {remaining} more line{remaining !== 1 ? "s" : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
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

    /* ── Trace (diagnostics only) ───────────────────────── */
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

    case "provider_retry": {
      if (!entry.text.trim()) return null;
      const t = entry.text.length > 240 ? entry.text.slice(0, 240) + "…" : entry.text;
      return (
        <Box paddingLeft={2} width={w}>
          <Text color="yellow" dimColor wrap="truncate-end">
            {t}
          </Text>
        </Box>
      );
    }

    /* ── Tool call ──────────────────────────────────────── */
    case "tool_call":
      return (
        <Box paddingLeft={1} width={w}>
          <ToolCallCard
            name={entry.name}
            argsJson={entry.argsJson}
            status={entry.status}
            startedAt={entry.startedAt}
            endedAt={entry.endedAt}
          />
        </Box>
      );

    /* ── Tool result ────────────────────────────────────── */
    case "tool_result":
      if (!entry.output.trim()) return null;
      return renderToolResult(entry.output, entry.ok, w);

    /* ── Ask-user (historical) ──────────────────────────── */
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
      const t = entry.content.length > 1200 ? entry.content.slice(0, 1200) + "…" : entry.content;
      return (
        <Box paddingLeft={2} flexDirection="column" width={w}>
          <Text color="magenta" dimColor bold>◈ thinking</Text>
          <Box paddingLeft={2}>
            <Text color="magenta" dimColor wrap="wrap">{t}</Text>
          </Box>
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
            const text = done ? step.slice(2) : step;
            return (
              <Box key={i} paddingLeft={2} gap={1}>
                <Text color={done ? "green" : "gray"}>{done ? "✓" : "○"}</Text>
                <Text color={done ? "green" : "gray"}>{`${i + 1}. ${text}`}</Text>
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
