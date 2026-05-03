import React from "react";
import { Box, Text } from "ink";

interface Props {
  taskId: string;
  goal: string;
  depth: number;
  status: "running" | "done" | "error" | "cancelled";
}

export function SubtaskCard({ taskId, goal, depth, status }: Props) {
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

  return (
    <Box paddingLeft={indent} marginY={0} gap={1}>
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
  );
}
