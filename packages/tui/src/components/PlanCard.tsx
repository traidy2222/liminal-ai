import React from "react";
import { Box, Text } from "ink";
import { countPlanStepsDone, isPlanStepDone, planStepLabel } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  steps: string[];
}

export function PlanCard({ steps }: Props) {
  const jarvis = usePersonaChrome().colors;
  const done = countPlanStepsDone(steps);
  const total = steps.length;
  const activeIndex = steps.findIndex((s) => !isPlanStepDone(s));

  return (
    <Box flexDirection="column" paddingLeft={1} marginY={0}>
      <Box gap={1}>
        <Text color={jarvis.accent} bold>
          Progress
        </Text>
        <Text color={jarvis.muted} dimColor>
          {done}/{total}
        </Text>
      </Box>
      {steps.map((step, i) => {
        const complete = isPlanStepDone(step);
        const active = !complete && i === activeIndex;
        const marker = complete ? "✓" : active ? "▸" : "○";
        const color = complete ? jarvis.assistant : active ? jarvis.accent : jarvis.muted;
        return (
          <Box key={i} gap={1} paddingLeft={1}>
            <Text color={color}>{marker}</Text>
            <Text color={color} dimColor={complete}>
              {complete ? planStepLabel(step) : step}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
