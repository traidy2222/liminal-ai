import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  steps: string[];
}

export function PlanCard({ steps }: Props) {
  const jarvis = usePersonaChrome().colors;
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={0}>
      <Text color={jarvis.accent} bold>
        Plan
      </Text>
      {steps.map((step, i) => (
        <Box key={i} gap={1}>
          <Text color={jarvis.muted} dimColor>
            {`  ${i + 1}. □`}
          </Text>
          <Text color={jarvis.muted} dimColor>
            {step}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
