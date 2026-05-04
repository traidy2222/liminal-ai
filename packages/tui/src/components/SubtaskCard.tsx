import React from "react";
import { Box, Text } from "ink";

interface Props {
  taskId: string;
  goal: string;
  depth: number;
  status: "running" | "done" | "error" | "cancelled";
  /** Live partial output from the running sub-agent (empty string when none yet). */
  partialOutput?: string;
}

export function SubtaskCard({ taskId, goal, depth, status, partialOutput }: Props) {
  const icon =
    status === "running"
      ? "⟳"
      : status === "done"
      ? "✓"
      : status === "cancelled"
      ? "⊘"
      : "✗";

  const color =
    status === "running"
      ? "yellow"
      : status === "done"
      ? "green"
      : "red";

  const indent = Math.max(0, depth) * 2;

  // Show last 120 chars of partial output while running
  const preview =
    status === "running" && partialOutput
      ? partialOutput.trimEnd().slice(-120).replace(/\n/g, " ↩ ")
      : null;

  return (
    <Box paddingLeft={indent} marginY={0} flexDirection="column">
      <Box gap={1}>
        <Text color="magenta" dimColor>
          {"⤷".repeat(Math.max(1, depth))}
        </Text>
        <Text color={color} bold>
          {icon}
        </Text>
        <Text color="gray" dimColor>
          {taskId.slice(0, 8)}
        </Text>
        <Text color="white">{goal.length > 80 ? goal.slice(0, 80) + "…" : goal}</Text>
      </Box>
      {preview && (
        <Box paddingLeft={indent + 4}>
          <Text color="gray" dimColor>
            {preview}
          </Text>
        </Box>
      )}
    </Box>
  );
}
