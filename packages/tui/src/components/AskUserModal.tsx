import React from "react";
import { Box, Text } from "ink";
import type { AgentEventMap } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  payload: AgentEventMap["ask_user"];
  input: string;
  width: number;
}

export function AskUserModal({ payload, input, width }: Props) {
  const jarvis = usePersonaChrome().colors;
  const w = Math.max(40, width - 2);
  const prompt =
    payload.prompt.length > 140 ? payload.prompt.slice(0, 140) + "…" : payload.prompt;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={jarvis.accent} width={w} paddingX={1}>
      <Text color={jarvis.accent} bold>◆ {prompt}</Text>
      <Box gap={1}>
        <Text color={jarvis.accent} bold>{">"}</Text>
        <Text color={jarvis.body}>{input}</Text>
        <Text color={jarvis.accent}>█</Text>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor color={jarvis.muted}>Enter to submit</Text>
        </Box>
      </Box>
    </Box>
  );
}
