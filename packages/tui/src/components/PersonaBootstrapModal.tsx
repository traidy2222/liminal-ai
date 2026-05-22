import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { PERSONA_QUICK_PRESETS, personaBootstrapStageHint } from "@liminal/core/persona-bootstrap-ui";
import {
  PERSONA_ARTIFACT_LABELS,
  PERSONA_ARTIFACT_ORDER,
  type PersonaArtifactPreview,
} from "@liminal/core/persona-bootstrap-progress";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  width: number;
  draft: string;
  submitting: boolean;
  progress: string | null;
  stage: string | null;
  allowSkip: boolean;
  artifacts?: PersonaArtifactPreview[] | null;
}

const GLYPH: Record<PersonaArtifactPreview["status"], string> = {
  pending: "○",
  streaming: "◐",
  done: "●",
  error: "✗",
};

function pickFocusArtifact(artifacts: PersonaArtifactPreview[] | null | undefined): PersonaArtifactPreview | null {
  if (!artifacts?.length) return null;
  const streaming = artifacts.filter((a) => a.status === "streaming");
  if (streaming.length === 0) return null;
  return streaming.reduce((best, cur) =>
    (cur.charCount ?? cur.content.length) >= (best.charCount ?? best.content.length) ? cur : best
  );
}

export function PersonaBootstrapModal({
  width,
  draft,
  submitting,
  progress,
  stage,
  allowSkip,
  artifacts,
}: Props) {
  const jarvis = usePersonaChrome().colors;
  const w = Math.max(42, width - 2);
  const hint = stage ? personaBootstrapStageHint(stage) : "";
  const focus = useMemo(() => pickFocusArtifact(artifacts), [artifacts]);

  const statusRow = PERSONA_ARTIFACT_ORDER.map((id) => {
    const a = artifacts?.find((x) => x.id === id);
    const status = a?.status ?? "pending";
    const short = PERSONA_ARTIFACT_LABELS[id].replace(/^soul\//, "").replace(/\.(md|json)$/, "");
    return `${GLYPH[status]}${short}`;
  }).join(" ");

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
          <Text color={jarvis.accent}>
            {progress ?? "Working…"}
            {hint ? ` · ${hint}` : ""}
          </Text>
          <Text dimColor color={jarvis.muted} wrap="truncate-end">
            {statusRow}
          </Text>
          {focus && focus.content ? (
            <Box
              flexDirection="column"
              marginTop={0}
              borderStyle="single"
              borderColor={jarvis.borderSoft}
              paddingX={1}
            >
              <Text color={jarvis.accent}>{focus.label}</Text>
              <Text color={jarvis.body} wrap="truncate-end">
                {focus.content.length > w - 4
                  ? `…${focus.content.slice(-(w - 4))}`
                  : focus.content}
              </Text>
            </Box>
          ) : null}
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
