import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { AgentEventMap } from "@liminal/core";

interface Props {
  payload: AgentEventMap["tool_approval"];
  width: number;
}

function getBestArg(name: string, args: Record<string, unknown>): string {
  const candidates = ["command", "path", "file_path", "query", "url", "key", "pid"];
  for (const k of candidates) {
    const v = args[k];
    if (typeof v === "string" && v) return `${k}: ${v.slice(0, 80)}`;
    if (typeof v === "number") return `${k}: ${v}`;
  }
  const json = JSON.stringify(args);
  return json.length > 80 ? json.slice(0, 79) + "…" : json;
}

export function ApprovalModal({ payload, width }: Props) {
  const [receivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const leftSec = Math.max(0, Math.ceil((receivedAt + payload.approvalTimeoutMs - now) / 1000));
  const arg = getBestArg(payload.name, payload.args);
  const w = Math.max(40, width - 2);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" width={w} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="magenta">⚠  {payload.name}</Text>
        <Text color={leftSec <= 10 ? "red" : "gray"}>auto-reject in {leftSec}s</Text>
      </Box>
      <Text dimColor color="white" wrap="truncate-end">
        {"   "}{arg}
      </Text>
      <Box gap={3} marginTop={0}>
        <Text color="green" bold>[A] Approve</Text>
        <Text color="red" bold>[R] Reject</Text>
      </Box>
    </Box>
  );
}
