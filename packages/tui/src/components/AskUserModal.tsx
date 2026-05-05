import React from "react";
import { Box, Text } from "ink";
import type { AgentEventMap } from "@liminal/core";

interface Props {
  payload: AgentEventMap["ask_user"];
  input: string;
  width: number;
}

export function AskUserModal({ payload, input, width }: Props) {
  const w = Math.max(40, width - 2);
  const prompt =
    payload.prompt.length > 140 ? payload.prompt.slice(0, 140) + "…" : payload.prompt;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" width={w} paddingX={1}>
      <Text color="blue" bold>◆ {prompt}</Text>
      <Box gap={1}>
        <Text color="cyan" bold>{">"}</Text>
        <Text color="white">{input}</Text>
        <Text color="cyan">█</Text>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor color="gray">Enter to submit</Text>
        </Box>
      </Box>
    </Box>
  );
}
