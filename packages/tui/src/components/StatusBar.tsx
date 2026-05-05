import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ContextSnapshot } from "@liminal/core";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface Props {
  modelSlug: string;
  personaName: string;
  snapshot: ContextSnapshot | null;
  busy: boolean;
  width: number;
}

export function StatusBar({ modelSlug, personaName, snapshot, busy, width }: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!busy) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, [busy]);

  const pct = snapshot ? Math.round(snapshot.usageFraction * 100) : null;
  const ctxColor = pct == null ? "gray" : pct >= 80 ? "red" : pct >= 60 ? "yellow" : "green";

  // Shorten slug: "openrouter/owl-alpha" → "owl-alpha"
  const rawModel = modelSlug.split("/").pop() ?? modelSlug;
  const model = rawModel.length > 30 ? rawModel.slice(0, 29) + "…" : rawModel;

  return (
    <Box width={width} paddingX={1} gap={0}>
      <Text bold color="cyan">❯❯ </Text>
      <Text color="white">{model}</Text>
      {personaName !== "Liminal" && <Text color="magenta"> · {personaName}</Text>}
      {pct != null && <Text color={ctxColor}> · ctx {pct}%</Text>}
      {snapshot?.masked === true && <Text color="yellow"> ⊙</Text>}
      {busy ? (
        <Text color="yellow"> · {FRAMES[frame]!}</Text>
      ) : (
        <Text color="green" dimColor> · ready</Text>
      )}
    </Box>
  );
}
