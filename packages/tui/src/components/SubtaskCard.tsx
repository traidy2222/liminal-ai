import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome, type TuiJarvisColors } from "../personaChromeContext.js";

interface Props {
  taskId: string;
  goal: string;
  depth: number;
  status: "running" | "done" | "error" | "cancelled";
  partialOutput?: string;
}

const STATUS_ICON: Record<string, string> = {
  running:   "⟳",
  done:      "✓",
  error:     "✗",
  cancelled: "⊘",
};

export function SubtaskCard({ taskId, goal, depth, status, partialOutput }: Props) {
  const jarvis = usePersonaChrome().colors;
  const statusColor: Record<string, TuiJarvisColors[keyof TuiJarvisColors]> = {
    running:   jarvis.accent,
    done:      jarvis.assistant,
    error:     jarvis.danger,
    cancelled: jarvis.muted,
  };
  const indent = Math.max(0, depth) * 2;
  const icon = STATUS_ICON[status] ?? "?";
  const color = statusColor[status] ?? jarvis.body;

  // Show last 4 non-empty lines of live output while running
  const outputLines =
    status === "running" && partialOutput
      ? partialOutput
          .trimEnd()
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(-4)
      : [];

  return (
    <Box paddingLeft={indent} marginY={0} flexDirection="column">
      {/* ── Header row ─────────────────────────────────────── */}
      <Box gap={1}>
        <Text color={jarvis.meta} dimColor>{"⤷".repeat(Math.max(1, depth))}</Text>
        <Text color={color} bold>{icon}</Text>
        <Text color={jarvis.muted} dimColor>{taskId.slice(0, 8)}</Text>
        <Text color={jarvis.body}>
          {goal.length > 90 ? goal.slice(0, 89) + "…" : goal}
        </Text>
      </Box>

      {/* ── Live output lines ──────────────────────────────── */}
      {outputLines.map((line, i) => (
        <Box key={i} paddingLeft={indent + 4}>
          <Text color={jarvis.muted} dimColor wrap="truncate-end">
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
