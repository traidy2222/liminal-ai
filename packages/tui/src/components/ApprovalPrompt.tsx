import React from "react";
import { Box, Text, useInput } from "ink";
import type { AgentEventMap } from "@liminal/core";

interface Props {
  payload: AgentEventMap["tool_approval"];
  onResolved: () => void;
}

export function ApprovalPrompt({ payload, onResolved }: Props) {
  const argsPreview = JSON.stringify(payload.args, null, 2).slice(0, 300);

  useInput((input, key) => {
    if (input === "a" || input === "A" || (key.return && true)) {
      if (input !== "r" && input !== "R" && input !== "e" && input !== "E") {
        if (input === "a" || input === "A" || key.return) {
          payload.resolve({ decision: "approve" });
          onResolved();
        }
      }
    }
    if (input === "r" || input === "R") {
      payload.resolve({ decision: "reject", reason: "Rejected by user" });
      onResolved();
    }
  });

  return (
    <Box
      borderStyle="double"
      borderColor="magenta"
      flexDirection="column"
      padding={1}
      marginY={1}
    >
      <Text bold color="magenta">
        Tool Approval Required
      </Text>
      <Box gap={1}>
        <Text color="gray">Tool:</Text>
        <Text color="cyan" bold>
          {payload.name}
        </Text>
      </Box>
      <Text color="gray" dimColor>
        {argsPreview}
      </Text>
      <Box gap={3} marginTop={1}>
        <Text color="green" bold>
          [A] Approve
        </Text>
        <Text color="red" bold>
          [R] Reject
        </Text>
      </Box>
    </Box>
  );
}
