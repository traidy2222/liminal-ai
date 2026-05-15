import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentEventMap } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  payload: AgentEventMap["ask_user"];
  onResolved: () => void;
}

export function AskUserPrompt({ payload, onResolved }: Props) {
  const jarvis = usePersonaChrome().colors;
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
      borderColor={jarvis.accent}
      flexDirection="column"
      padding={1}
      marginY={1}
    >
      <Text bold color={jarvis.accent}>
        Agent Question
      </Text>
      <Text color={jarvis.body}>{payload.prompt}</Text>
      <Box gap={1} marginTop={1}>
        <Text color={jarvis.accent}>Your answer:</Text>
        <Text color={jarvis.body}>
          {input}
          <Text color={jarvis.accent}>█</Text>
        </Text>
      </Box>
      <Text color={jarvis.muted} dimColor>
        Press Enter to submit
      </Text>
    </Box>
  );
}
