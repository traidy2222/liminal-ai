import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  inference: string;
  streaming?: boolean;
  confidence?: "low" | "medium" | "high";
  next_action?: string;
}

export function ReasonCard({ inference, streaming, confidence, next_action }: Props) {
  const { colors } = usePersonaChrome();
  const confidenceColor =
    confidence === "low" ? colors.warn : confidence === "high" ? colors.assistant : colors.muted;
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={0}>
      <Box flexDirection="row" gap={1}>
        <Text color={colors.muted} dimColor>{"→ "}</Text>
        <Text color={colors.muted} dimColor italic>
          {streaming && inference.length > 300 ? "…" + inference.slice(-300) : inference}
          {streaming ? "▍" : ""}
        </Text>
      </Box>
      {(confidence || next_action) && (
        <Box paddingLeft={4} flexDirection="row" gap={1}>
          {confidence && (
            <Text color={confidenceColor} dimColor>{"[" + confidence + "]"}</Text>
          )}
          {next_action && (
            <Text color={colors.muted} dimColor>{"→ " + next_action}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
