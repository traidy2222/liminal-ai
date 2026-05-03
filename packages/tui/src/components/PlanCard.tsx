import React from "react";
import { Box, Text } from "ink";

interface Props {
  steps: string[];
}

export function PlanCard({ steps }: Props) {
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={0}>
      <Text color="blueBright" bold>
        Plan
      </Text>
      {steps.map((step, i) => (
        <Box key={i} gap={1}>
          <Text color="gray" dimColor>
            {`  ${i + 1}. □`}
          </Text>
          <Text color="gray" dimColor>
            {step}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
