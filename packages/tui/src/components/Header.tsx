import React from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@liminal/core";

interface Props {
  snapshot: ContextSnapshot | null;
  busy: boolean;
  /** Display name of the active persona. Shown as "[name]" suffix when not "Liminal". */
  personaName?: string;
}

export function Header({ snapshot, busy, personaName = "Liminal" }: Props) {
  const pct = snapshot ? Math.round(snapshot.usageFraction * 100) : 0;
  const barColor = pct >= 80 ? "red" : pct >= 60 ? "yellow" : "green";
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const isCustomPersona = personaName !== "Liminal";

  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text bold color="cyan">Liminal</Text>
        {isCustomPersona && (
          <Text color="magenta">[{personaName}]</Text>
        )}
        {busy && <Text color="yellow">⟳</Text>}
      </Box>
      {snapshot ? (
        <Box gap={1}>
          <Text color={barColor}>{bar}</Text>
          <Text color={barColor}>{pct}%</Text>
          {snapshot.masked && <Text color="yellow">[masked]</Text>}
        </Box>
      ) : (
        <Text color="gray">minimax/minimax-m2.5</Text>
      )}
    </Box>
  );
}
