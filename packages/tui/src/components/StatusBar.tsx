import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface Props {
  modelSlug: string;
  personaName: string;
  snapshot: ContextSnapshot | null;
  busy: boolean;
  width: number;
  /** Short background memory sync line (omit when null). */
  memorySync?: string | null;
}

export function StatusBar({
  modelSlug,
  personaName,
  snapshot,
  busy,
  width,
  memorySync,
}: Props) {
  const jarvis = usePersonaChrome().colors;
  const statusBarIntervalMs = usePersonaChrome().statusBarIntervalMs;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!busy) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), statusBarIntervalMs);
    return () => clearInterval(id);
  }, [busy, statusBarIntervalMs]);

  const pct = snapshot
    ? Math.round((snapshot.requestUsageFraction ?? snapshot.usageFraction) * 100)
    : null;
  const ctxColor = pct == null ? jarvis.muted : pct >= 80 ? jarvis.danger : pct >= 60 ? jarvis.warn : jarvis.assistant;

  // Shorten slug: "provider/name" → last segment (e.g. qwen/qwen3.5-9b → qwen3.5-9b)
  const rawModel = modelSlug.split("/").pop() ?? modelSlug;
  const model = rawModel.length > 30 ? rawModel.slice(0, 29) + "…" : rawModel;

  return (
    <Box width={width} paddingX={1} gap={0}>
      <Text bold color={jarvis.accent}>❯❯ </Text>
      <Text color={jarvis.body}>{model}</Text>
      {personaName !== "Liminal" && <Text color={jarvis.meta}> · {personaName}</Text>}
      {pct != null && <Text color={ctxColor}> · ctx {pct}%</Text>}
      {snapshot?.masked === true && <Text color={jarvis.warn}> ⊙</Text>}
      {busy ? (
        <Text color={jarvis.warn}> · {FRAMES[frame]!}</Text>
      ) : (
        <Text color={jarvis.assistant} dimColor> · ready</Text>
      )}
      {memorySync ? (
        <Text dimColor color={jarvis.meta}> · {memorySync}</Text>
      ) : null}
    </Box>
  );
}
