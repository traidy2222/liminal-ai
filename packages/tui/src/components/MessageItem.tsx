import React from "react";
import { Box, Text } from "ink";
import type { MessageEntry } from "../useAgent.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { SubtaskCard } from "./SubtaskCard.js";
import { ThinkCard } from "./ThinkCard.js";
import { ReasonCard } from "./ReasonCard.js";
import { usePersonaChrome, type TuiJarvisColors } from "../personaChromeContext.js";

const MAX_RESULT_LINES = 8;
const MAX_RESULT_LINE_LEN = 180;

function renderToolResult(output: string, ok: boolean, w: number, j: TuiJarvisColors): React.ReactElement {
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
              color={ok ? j.muted : j.danger}
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
          <Text dimColor color={j.muted}>
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
  const jarvis = usePersonaChrome().colors;
  const w = Math.max(20, width);

  switch (entry.kind) {
    /* ── User message ───────────────────────────────────── */
    case "user":
      return (
        <Box flexDirection="row" marginTop={1} gap={1} width={w}>
          <Text color={jarvis.userMark} bold>▶</Text>
          <Box flexGrow={1}>
            <Text color={jarvis.body} wrap="wrap">
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
          <Text color={jarvis.assistant} wrap="wrap">
            {text}
            {entry.streaming && <Text color={jarvis.assistant}>▌</Text>}
          </Text>
        </Box>
      );
    }

    case "pulse_nudge": {
      const t = entry.text.length > 600 ? entry.text.slice(0, 600) + "…" : entry.text;
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={1} width={w} borderStyle="round" borderColor={jarvis.meta}>
          <Text color={jarvis.meta} dimColor bold>
            ◇ Pulse
          </Text>
          <Box paddingLeft={2}>
            <Text color={jarvis.body} dimColor wrap="wrap">
              {t}
            </Text>
          </Box>
        </Box>
      );
    }

    case "turn_header": {
      const sec = Math.round(entry.durationMs / 1000);
      const tools = entry.keyTools.length > 0 ? entry.keyTools.join(", ") : "—";
      const term = entry.terminationReason !== "ok" ? ` · ${entry.terminationReason}` : "";
      return (
        <Box paddingLeft={2} width={w}>
          <Text dimColor color={jarvis.meta}>
            {entry.intentClass} · {entry.outcomeScore.toFixed(2)} · {entry.toolCount} tools · {sec}s · {tools}{term}
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
          <Text dimColor color={jarvis.muted} wrap="truncate-end">
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
          <Text color={jarvis.warn} dimColor wrap="truncate-end">
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
      return renderToolResult(entry.output, entry.ok, w, jarvis);

    /* ── Ask-user (historical) ──────────────────────────── */
    case "ask_user":
      return (
        <Box flexDirection="column" paddingLeft={2} width={w}>
          <Text color={jarvis.accent} bold>◆ Agent asked:</Text>
          <Box paddingLeft={2}>
            <Text color={jarvis.body} wrap="wrap">
              {entry.prompt.length > 600 ? entry.prompt.slice(0, 600) + "…" : entry.prompt}
            </Text>
          </Box>
        </Box>
      );

    /* ── Think ──────────────────────────────────────────── */
    case "model_reasoning":
      return (
        <Box flexDirection="column" paddingLeft={2} width={w}>
          <Text color={jarvis.warn} dimColor italic>
            {"🧠 "}
            {entry.streaming && entry.text.length > 400 ? "…" + entry.text.slice(-400) : entry.text}
            {entry.streaming ? "▍" : ""}
          </Text>
        </Box>
      );

    case "think":
      return (
        <Box width={w}>
          <ThinkCard
            content={entry.content}
            streaming={entry.streaming}
            tool_families={entry.tool_families}
            scope={entry.scope}
            unknowns={entry.unknowns}
            clarification_needed={entry.clarification_needed}
            clarification_question={entry.clarification_question}
            self_check={entry.self_check}
          />
        </Box>
      );

    case "reason":
      return (
        <Box width={w}>
          <ReasonCard
            inference={entry.inference}
            streaming={entry.streaming}
            confidence={entry.confidence}
            next_action={entry.next_action}
          />
        </Box>
      );

    /* ── Plan ───────────────────────────────────────────── */
    case "plan":
      if (!entry.steps.length) return null;
      return (
        <Box flexDirection="column" paddingLeft={2} width={w}>
          <Text color={jarvis.accent} bold>▸ Plan</Text>
          {entry.steps.map((step, i) => {
            const done = step.startsWith("✓");
            const text = done ? step.slice(2) : step;
            return (
              <Box key={i} paddingLeft={2} gap={1}>
                <Text color={done ? jarvis.assistant : jarvis.muted}>{done ? "✓" : "○"}</Text>
                <Text color={done ? jarvis.assistant : jarvis.muted}>{`${i + 1}. ${text}`}</Text>
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
          <Text color={jarvis.warn} dimColor>
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
