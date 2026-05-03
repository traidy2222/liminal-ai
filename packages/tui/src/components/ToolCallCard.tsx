import React from "react";
import { Box, Text } from "ink";

type Status = "streaming" | "pending_approval" | "running" | "done" | "error";

interface Props {
  name: string;
  argsJson: string;
  status: Status;
}

const STATUS_COLOR: Record<Status, string> = {
  streaming: "yellow",
  pending_approval: "magenta",
  running: "cyan",
  done: "green",
  error: "red",
};

const STATUS_LABEL: Record<Status, string> = {
  streaming: "⟳ forming",
  pending_approval: "⚠ approval needed",
  running: "⟳ running",
  done: "✓ done",
  error: "✗ error",
};

export function ToolCallCard({ name, argsJson, status }: Props) {
  const color = STATUS_COLOR[status];
  const preview = argsJson.length > 120 ? argsJson.slice(0, 120) + "…" : argsJson;

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      paddingX={1}
      marginY={0}
    >
      <Box gap={2}>
        <Text bold color="cyan">
          {name}
        </Text>
        <Text color={color}>{STATUS_LABEL[status]}</Text>
      </Box>
      {preview && (
        <Text color="gray" dimColor>
          {preview}
        </Text>
      )}
    </Box>
  );
}
