import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { AgentEventMap } from "@liminal/core";
import { getToolCategory } from "./ToolCallCard.js";

interface Props {
  payload: AgentEventMap["tool_approval"];
  width: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  shell:         "red",
  file:          "blue",
  web:           "magenta",
  memory:        "yellow",
  vault:         "cyan",
  code:          "green",
  git:           "yellow",
  markets:       "yellow",
  vision:        "magenta",
  docs:          "cyan",
  orchestration: "magenta",
  context:       "gray",
  other:         "white",
};

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
  const [receivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const leftSec = Math.max(0, Math.ceil((receivedAt + payload.approvalTimeoutMs - now) / 1000));
  const w = Math.max(40, width - 2);
  const category = getToolCategory(payload.name);
  const catColor = CATEGORY_COLOR[category] ?? "white";

  // Format each arg as its own labeled line
  const argEntries = Object.entries(payload.args).filter(([, v]) => v !== undefined && v !== null);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" width={w} paddingX={1}>
      {/* ── Header ──────────────────────────────────────────── */}
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="magenta">⚠  approval needed</Text>
          <Text bold color={catColor}>·</Text>
          <Text bold color={catColor}>{payload.name}</Text>
        </Box>
        <Text color={leftSec <= 10 ? "red" : "gray"}>
          auto-reject in {leftSec}s
        </Text>
      </Box>

      {/* ── Args ────────────────────────────────────────────── */}
      {argEntries.length > 0 && (
        <Box flexDirection="column" marginTop={0} paddingLeft={1}>
          {argEntries.map(([k, v]) => (
            <Box key={k} gap={1}>
              <Text color="gray" dimColor>{k}:</Text>
              <Text color="white" wrap="truncate-end">
                {formatArgValue(v)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Actions ─────────────────────────────────────────── */}
      <Box gap={4} marginTop={0}>
        <Text color="green" bold>[A] Approve</Text>
        <Text color="red"   bold>[R] Reject</Text>
      </Box>
    </Box>
  );
}
