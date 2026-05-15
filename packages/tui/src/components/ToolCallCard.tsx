import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { jarvis } from "../theme/jarvis.js";

// ── Category detection ───────────────────────────────────────────────────────

type ToolCategory =
  | "shell" | "file" | "web" | "memory" | "vault" | "code"
  | "git" | "markets" | "vision" | "docs" | "orchestration" | "context" | "other";

export function getToolCategory(name: string): ToolCategory {
  if (/^(run_shell|run_background|kill_process|list_processes|read_process_output)$/.test(name)) return "shell";
  if (/^(read_file|write_file|list_dir|apply_diff|patch_file)$/.test(name)) return "file";
  if (/^(web_fetch|web_search|weather_lookup)$/.test(name)) return "web";
  if (/^(remember|recall|recall_type|recall_relevant|search_memory|forget|forget_type|memory_stats|memory_consolidate|memory_query|memory_graph)$/.test(name)) return "memory";
  if (name.startsWith("vault_")) return "vault";
  if (/^(ast_grep|symbol_index|find_references|run_tests|run_lint|execute_code|repo_map)$/.test(name)) return "code";
  if (name.startsWith("git_")) return "git";
  if (name.startsWith("markets_")) return "markets";
  if (/^(vision_analyze|upload_image)$/.test(name)) return "vision";
  if (name.startsWith("doc_")) return "docs";
  if (/^(spawn_agent|wait_for_agents|cancel_agent|list_agents|verify_result)$/.test(name)) return "orchestration";
  if (/^(check_context|compress_context)$/.test(name)) return "context";
  return "other";
}

type JarvisColor = (typeof jarvis)[keyof typeof jarvis];

const CATEGORY_META: Record<ToolCategory, { icon: string; color: JarvisColor }> = {
  shell:         { icon: "▶", color: jarvis.danger },
  file:          { icon: "◇", color: jarvis.accent },
  web:           { icon: "◎", color: jarvis.meta },
  memory:        { icon: "◈", color: jarvis.warn },
  vault:         { icon: "⊚", color: jarvis.accent },
  code:          { icon: "◆", color: jarvis.assistant },
  git:           { icon: "⌥", color: jarvis.warn },
  markets:       { icon: "◉", color: jarvis.warn },
  vision:        { icon: "◑", color: jarvis.meta },
  docs:          { icon: "▣", color: jarvis.accent },
  orchestration: { icon: "⟴", color: jarvis.meta },
  context:       { icon: "⊙", color: jarvis.muted },
  other:         { icon: "⚙", color: jarvis.body },
};

// ── Status meta ──────────────────────────────────────────────────────────────

export type ToolStatus = "streaming" | "pending_approval" | "running" | "done" | "error";

const STATUS_ICON: Record<ToolStatus, string> = {
  streaming:        "…",
  pending_approval: "⚠",
  running:          "⟳",
  done:             "✓",
  error:            "✗",
};

export const STATUS_COLOR: Record<ToolStatus, JarvisColor> = {
  streaming:        jarvis.warn,
  pending_approval: jarvis.meta,
  running:          jarvis.accent,
  done:             jarvis.assistant,
  error:            jarvis.danger,
};

const STATUS_LABEL: Record<ToolStatus, string> = {
  streaming:        "forming",
  pending_approval: "approval needed",
  running:          "running",
  done:             "done",
  error:            "failed",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

export function parsePrimaryArg(argsJson: string): string {
  if (!argsJson) return "";
  try {
    const a = JSON.parse(argsJson) as Record<string, unknown>;
    for (const k of ["command", "path", "file_path", "query", "url", "key", "goal", "topic", "pid", "task_id", "ticker", "symbol", "name"]) {
      const v = a[k];
      if (typeof v === "string" && v) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 55 ? flat.slice(0, 54) + "…" : flat}`;
      }
      if (typeof v === "number") return `${k}: ${v}`;
    }
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "string" && v.length > 0 && v.length < 100) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 55 ? flat.slice(0, 54) + "…" : flat}`;
      }
    }
  } catch { /* ignore */ }
  return "";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  name: string;
  argsJson: string;
  status: ToolStatus;
  startedAt: number;
  endedAt?: number;
}

export function ToolCallCard({ name, argsJson, status, startedAt, endedAt }: Props) {
  const [, setTick] = useState(0);
  const isActive = status === "streaming" || status === "running" || status === "pending_approval";

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [isActive]);

  const elapsed = isActive
    ? Date.now() - startedAt
    : endedAt !== undefined
    ? endedAt - startedAt
    : null;

  const category = getToolCategory(name);
  const { icon: catIcon, color: catColor } = CATEGORY_META[category];
  const statusColor = STATUS_COLOR[status];
  const arg = parsePrimaryArg(argsJson);

  return (
    <Box
      borderStyle="round"
      borderColor={statusColor}
      flexDirection="column"
      paddingX={1}
      marginY={0}
    >
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text color={catColor}>{catIcon}</Text>
          <Text bold color={jarvis.body}>{name}</Text>
          {arg && (
            <Text color={jarvis.muted} dimColor>{arg}</Text>
          )}
        </Box>
        <Box gap={1}>
          {elapsed !== null && (
            <Text color={jarvis.muted} dimColor>{formatElapsed(elapsed)}</Text>
          )}
          <Text color={statusColor} bold>
            {STATUS_ICON[status]} {STATUS_LABEL[status]}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
