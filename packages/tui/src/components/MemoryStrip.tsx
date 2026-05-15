import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { MessageEntry } from "../useAgent.js";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  messages: MessageEntry[];
  personaName: string;
  /** Max bullet lines (excluding title). */
  maxBullets?: number;
}

function parsePinnedFromEnv(): string[] {
  const raw = process.env["AGENT_TUI_MEMORY_BULLETS"]?.trim();
  if (!raw) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function thinkSnippets(messages: MessageEntry[], max: number): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    const m = messages[i]!;
    if (m.kind === "think") {
      const line = m.content.replace(/\s+/g, " ").trim().slice(0, 76);
      if (line) out.push(line);
    }
  }
  return out.reverse();
}

/**
 * Lightweight “session memory” strip: pinned env bullets + recent think one-liners.
 */
export function MemoryStrip({ messages, personaName, maxBullets = 4 }: Props) {
  const jarvis = usePersonaChrome().colors;
  const bullets = useMemo(() => {
    const pinned = parsePinnedFromEnv();
    const thinks = thinkSnippets(messages, 1);
    const cwd = process.env["AGENT_WORKSPACE_ROOT"]?.trim() || process.cwd();
    const head: string[] = [];
    head.push(`Persona: ${personaName}`);
    head.push(`Workspace: ${cwd.length > 64 ? `…${cwd.slice(-60)}` : cwd}`);
    for (const p of pinned) head.push(p);
    for (const t of thinks) head.push(`Think: ${t}`);
    return head.slice(0, maxBullets + 2);
  }, [messages, personaName, maxBullets]);

  const boxHeight = 3 + bullets.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={jarvis.meta}
      paddingX={1}
      paddingY={1}
      marginBottom={1}
      height={boxHeight}
      overflowY="hidden"
    >
      <Text bold color={jarvis.meta}>
        MEMORY / SESSION NOTES
      </Text>
      {bullets.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={jarvis.muted}>• </Text>
          <Text dimColor color={jarvis.muted}>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
