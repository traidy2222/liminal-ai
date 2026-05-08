import React from "react";
import { Box, Text } from "ink";

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

const STATUS_COLOR: Record<string, string> = {
  running:   "cyan",
  done:      "green",
  error:     "red",
  cancelled: "gray",
};

export function SubtaskCard({ taskId, goal, depth, status, partialOutput }: Props) {
  const indent = Math.max(0, depth) * 2;
  const icon = STATUS_ICON[status] ?? "?";
  const color = STATUS_COLOR[status] ?? "white";

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
        <Text color="magenta" dimColor>{"⤷".repeat(Math.max(1, depth))}</Text>
        <Text color={color} bold>{icon}</Text>
        <Text color="gray" dimColor>{taskId.slice(0, 8)}</Text>
        <Text color="white">
          {goal.length > 90 ? goal.slice(0, 89) + "…" : goal}
        </Text>
      </Box>

      {/* ── Live output lines ──────────────────────────────── */}
      {outputLines.map((line, i) => (
        <Box key={i} paddingLeft={indent + 4}>
          <Text color="gray" dimColor wrap="truncate-end">
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
