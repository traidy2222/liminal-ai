import React from "react";
import { Box, Text } from "ink";
import {
  PERSONA_QUICK_PRESETS,
  personaBootstrapStageHint,
} from "@liminal/core/persona-bootstrap-ui";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  width: number;
  draft: string;
  submitting: boolean;
  progress: string | null;
  stage: string | null;
  allowSkip: boolean;
}

export function PersonaBootstrapModal({
  width,
  draft,
  submitting,
  progress,
  stage,
  allowSkip,
}: Props) {
  const jarvis = usePersonaChrome().colors;
  const w = Math.max(42, width - 2);
  const hint = stage ? personaBootstrapStageHint(stage) : "";

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={jarvis.borderStrong}
      width={w}
      paddingX={1}
      marginBottom={0}
    >
      <Box marginBottom={0}>
        <Text bold color={jarvis.accent}>
          ◆ WELCOME — PERSONALITY
        </Text>
      </Box>
      <Box marginTop={0} marginBottom={1}>
        <Text color={jarvis.body} wrap="wrap">
          Choose how the assistant should sound (tone, pace, humor). Tools and safety stay the same.
          Refine later with set_persona or web Settings.
        </Text>
      </Box>
      <Text dimColor color={jarvis.muted}>
        Presets: 1–4 fill the line below · Enter save
        {allowSkip ? " · d default voice" : ""}
        {allowSkip ? " · type skip or /skip" : ""}
      </Text>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {PERSONA_QUICK_PRESETS.map((p, i) => (
          <Text key={i} dimColor color={jarvis.muted} wrap="truncate-end">
            {`  ${i + 1}. `}
            {p.length > w - 8 ? `${p.slice(0, w - 10)}…` : p}
          </Text>
        ))}
      </Box>
      {submitting && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={jarvis.accent}>{progress ?? "Working…"}{hint ? ` · ${hint}` : ""}</Text>
        </Box>
      )}
      <Box borderStyle="single" borderColor={jarvis.borderSoft} paddingX={1} marginTop={0}>
        <Text color={jarvis.body} wrap="truncate-end">
          {draft.length > 0 ? draft : " "}
        </Text>
      </Box>
    </Box>
  );
}
