import React from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@dreamthedream/core";

interface Props {
  snapshot: ContextSnapshot | null;
  busy: boolean;
}

export function Header({ snapshot, busy }: Props) {
  const pct = snapshot ? Math.round(snapshot.usageFraction * 100) : 0;
  const barColor = pct >= 80 ? "red" : pct >= 60 ? "yellow" : "green";
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);

  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text bold color="cyan">dreamthedream</Text>
        {busy && <Text color="yellow">⟳</Text>}
      </Box>
      {snapshot ? (
        <Box gap={1}>
          <Text color={barColor}>{bar}</Text>
          <Text color={barColor}>{pct}%</Text>
          {snapshot.masked && <Text color="yellow">[masked]</Text>}
        </Box>
      ) : (
        <Text color="gray">model: openrouter/owl-alpha</Text>
      )}
    </Box>
  );
}
