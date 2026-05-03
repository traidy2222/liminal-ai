import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentEventMap } from "@liminal/core";

interface Props {
  payload: AgentEventMap["ask_user"];
  onResolved: () => void;
}

export function AskUserPrompt({ payload, onResolved }: Props) {
  const [input, setInput] = useState("");

  useInput((char, key) => {
    if (key.return) {
      payload.resolve(input);
      onResolved();
    } else if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
    } else if (char && !key.ctrl && !key.meta) {
      setInput((s) => s + char);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="blue"
      flexDirection="column"
      padding={1}
      marginY={1}
    >
      <Text bold color="blue">
        Agent Question
      </Text>
      <Text color="white">{payload.prompt}</Text>
      <Box gap={1} marginTop={1}>
        <Text color="cyan">Your answer:</Text>
        <Text color="white">
          {input}
          <Text color="cyan">█</Text>
        </Text>
      </Box>
      <Text color="gray" dimColor>
        Press Enter to submit
      </Text>
    </Box>
  );
}
