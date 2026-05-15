import React from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

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
  const jarvis = usePersonaChrome().colors;
  const pct = snapshot ? Math.round(snapshot.usageFraction * 100) : 0;
  const barColor = pct >= 80 ? jarvis.danger : pct >= 60 ? jarvis.warn : jarvis.assistant;
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const isCustomPersona = personaName !== "Liminal";
  const sessionShort = taskId.length > 10 ? `${taskId.slice(0, 8)}…` : taskId;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={jarvis.accent} paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={jarvis.accent}>
            LIMINAL TUI
          </Text>
          {busy && <Text color={jarvis.warn}>⟳</Text>}
        </Box>
        <Box gap={2}>
          <Text color={jarvis.muted}>
            SESSION {sessionShort}
          </Text>
          <Text color={jarvis.muted}>
            MODEL{" "}
            <Text color={jarvis.body}>
              {modelSlug.length > 36 ? `${modelSlug.slice(0, 34)}…` : modelSlug}
            </Text>
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Box gap={1}>
          {isCustomPersona ? (
            <Text color={jarvis.meta} bold>
              Persona [{personaName}]
            </Text>
          ) : (
            <Text dimColor color={jarvis.muted}>
              Default harness persona
            </Text>
          )}
        </Box>
        {snapshot ? (
          <Box gap={1}>
            <Text color={barColor}>{bar}</Text>
            <Text color={barColor}>{pct}%</Text>
            {snapshot.masked && <Text color={jarvis.warn}>[masked]</Text>}
          </Box>
        ) : (
          <Text dimColor color={jarvis.muted}>
            context …
          </Text>
        )}
      </Box>
    </Box>
  );
}
