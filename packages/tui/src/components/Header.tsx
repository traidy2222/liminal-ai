import React from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@liminal/core";

interface Props {
  snapshot: ContextSnapshot | null;
  busy: boolean;
  personaName?: string;
  /** Harness task id (shown truncated like the dashboard mock). */
  taskId: string;
  /** OpenRouter-style model slug from harness config. */
  modelSlug: string;
}

export function Header({
  snapshot,
  busy,
  personaName = "Liminal",
  taskId,
  modelSlug,
}: Props) {
  const pct = snapshot ? Math.round(snapshot.usageFraction * 100) : 0;
  const barColor = pct >= 80 ? "red" : pct >= 60 ? "yellow" : "green";
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const isCustomPersona = personaName !== "Liminal";
  const sessionShort = taskId.length > 10 ? `${taskId.slice(0, 8)}…` : taskId;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="cyan">
            LIMINAL TUI
          </Text>
          {busy && <Text color="yellow">⟳</Text>}
        </Box>
        <Box gap={2}>
          <Text color="gray">
            SESSION {sessionShort}
          </Text>
          <Text color="gray">
            MODEL{" "}
            <Text color="white">
              {modelSlug.length > 36 ? `${modelSlug.slice(0, 34)}…` : modelSlug}
            </Text>
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Box gap={1}>
          {isCustomPersona ? (
            <Text color="magenta" bold>
              Persona [{personaName}]
            </Text>
          ) : (
            <Text dimColor color="gray">
              Default harness persona
            </Text>
          )}
        </Box>
        {snapshot ? (
          <Box gap={1}>
            <Text color={barColor}>{bar}</Text>
            <Text color={barColor}>{pct}%</Text>
            {snapshot.masked && <Text color="yellow">[masked]</Text>}
          </Box>
        ) : (
          <Text dimColor color="gray">
            context …
          </Text>
        )}
      </Box>
    </Box>
  );
}
