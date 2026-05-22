import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentEventMap } from "@liminal/core";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  payload: AgentEventMap["tool_approval"];
  onResolved: () => void;
}

function contextTag(toolName: string): string {
  if (toolName === "write_file" || toolName === "edit_file") return "resource_lock.write";
  if (toolName === "run_shell" || toolName === "run_background") return "shell.exec";
  if (toolName === "kill_process") return "process.control";
  return `approval.${toolName}`;
}

function resourceLines(name: string, args: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const cwd = args["cwd"];
  if (typeof cwd === "string" && cwd) lines.push(`cwd: ${cwd}`);
  const path = args["path"] ?? args["file_path"];
  if (typeof path === "string" && path) lines.push(`path: ${path}`);
  const command = args["command"];
  if (typeof command === "string" && command) {
    const c = command.length > 120 ? `${command.slice(0, 118)}…` : command;
    lines.push(`command: ${c}`);
  }
  const pid = args["pid"];
  if (typeof pid === "number") lines.push(`pid: ${pid}`);
  if (lines.length === 0) {
    const raw = JSON.stringify(args, null, 2);
    lines.push(raw.length > 320 ? `${raw.slice(0, 318)}…` : raw);
  }
  return lines.slice(0, 6);
}

export function ApprovalPrompt({ payload, onResolved }: Props) {
  const jarvis = usePersonaChrome().colors;
  const [receivedAt] = useState(() => Date.now());
  const deadline = receivedAt + payload.approvalTimeoutMs;
  const [now, setNow] = useState(() => Date.now());
  const tag = useMemo(() => contextTag(payload.name), [payload.name]);
  const resources = useMemo(
    () => resourceLines(payload.name, payload.args),
    [payload.name, payload.args]
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const leftSec = Math.max(0, Math.ceil((deadline - now) / 1000));

  useInput((input, key) => {
    if (input === "r" || input === "R" || input === "d" || input === "D") {
      payload.resolve({ decision: "reject", reason: "Rejected by user" });
      onResolved();
      return;
    }
    if (input === "a" || input === "A" || input === "s" || input === "S" || key.return) {
      payload.resolve({ decision: "approve" });
      onResolved();
    }
  });

  return (
    <Box
      borderStyle="double"
      borderColor={jarvis.meta}
      flexDirection="column"
      padding={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={jarvis.meta}>
          SAFETY APPROVAL REQUIRED
        </Text>
        <Text backgroundColor={jarvis.meta} color="black">
          {" "}
          {tag}
          {" "}
        </Text>
      </Box>
      <Box marginY={1}>
        <Text color={jarvis.muted}>
          Agent requests <Text color={jarvis.accent}>{payload.name}</Text> with the following context:
        </Text>
      </Box>
      {resources.map((line, i) => (
        <Text key={i} dimColor color={jarvis.body}>
          {"  · "}
          {line}
        </Text>
      ))}
      <Box marginY={1}>
        <Text color={leftSec <= 10 ? jarvis.warn : jarvis.muted}>
          Auto-reject in {leftSec}s (cap {Math.round(payload.approvalTimeoutMs / 1000)}s)
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={jarvis.assistant} bold>
          [A] Approve once
        </Text>
        <Text color={jarvis.assistant}>
          [S] Approve (same as A — session-wide auto-approve not wired yet)
        </Text>
        <Text color={jarvis.danger} bold>
          [D] Deny
        </Text>
        <Text dimColor color={jarvis.muted}>
          [R] Reject (alias) · Enter approves
        </Text>
      </Box>
    </Box>
  );
}
