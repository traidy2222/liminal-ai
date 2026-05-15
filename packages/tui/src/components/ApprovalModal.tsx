import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { AgentEventMap } from "@liminal/core";
import { getToolCategory } from "./ToolCallCard.js";
import { usePersonaChrome, type TuiJarvisColors } from "../personaChromeContext.js";

interface Props {
  payload: AgentEventMap["tool_approval"];
  width: number;
}

function formatArgValue(v: unknown): string {
  if (typeof v === "string") {
    const flat = v.replace(/\n/g, "↩");
    return flat.length > 100 ? flat.slice(0, 99) + "…" : flat;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 100 ? s.slice(0, 99) + "…" : s;
}

export function ApprovalModal({ payload, width }: Props) {
  const jarvis = usePersonaChrome().colors;
  const categoryColor: Record<string, TuiJarvisColors[keyof TuiJarvisColors]> = {
    shell:         jarvis.danger,
    file:          jarvis.accent,
    web:           jarvis.meta,
    memory:        jarvis.warn,
    vault:         jarvis.accent,
    code:          jarvis.assistant,
    git:           jarvis.warn,
    markets:       jarvis.warn,
    vision:        jarvis.meta,
    docs:          jarvis.accent,
    orchestration: jarvis.meta,
    context:       jarvis.muted,
    other:         jarvis.body,
  };
  const [receivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const leftSec = Math.max(0, Math.ceil((receivedAt + payload.approvalTimeoutMs - now) / 1000));
  const w = Math.max(40, width - 2);
  const category = getToolCategory(payload.name);
  const catColor = categoryColor[category] ?? jarvis.body;

  // Format each arg as its own labeled line
  const argEntries = Object.entries(payload.args).filter(([, v]) => v !== undefined && v !== null);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={jarvis.meta} width={w} paddingX={1}>
      {/* ── Header ──────────────────────────────────────────── */}
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={jarvis.meta}>⚠  approval needed</Text>
          <Text bold color={catColor}>·</Text>
          <Text bold color={catColor}>{payload.name}</Text>
        </Box>
        <Text color={leftSec <= 10 ? jarvis.danger : jarvis.muted}>
          auto-reject in {leftSec}s
        </Text>
      </Box>

      {/* ── Args ────────────────────────────────────────────── */}
      {argEntries.length > 0 && (
        <Box flexDirection="column" marginTop={0} paddingLeft={1}>
          {argEntries.map(([k, v]) => (
            <Box key={k} gap={1}>
              <Text color={jarvis.muted} dimColor>{k}:</Text>
              <Text color={jarvis.body} wrap="truncate-end">
                {formatArgValue(v)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Actions ─────────────────────────────────────────── */}
      <Box gap={4} marginTop={0}>
        <Text color={jarvis.assistant} bold>[A] Approve</Text>
        <Text color={jarvis.danger}   bold>[R] Reject</Text>
      </Box>
    </Box>
  );
}
