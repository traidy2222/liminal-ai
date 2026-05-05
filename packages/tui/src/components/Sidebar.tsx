import React from "react";
import { Box, Text } from "ink";

export type ShellPanel = "chat" | "tasks" | "agents" | "memory" | "settings";

interface Props {
  active: ShellPanel;
  /** Narrow mode: hide labels, icons only. */
  compact?: boolean;
  /** Clamp rail to terminal height (prevents vertical spill). */
  height?: number;
}

const ROWS: Array<{ id: ShellPanel; icon: string; label: string }> = [
  { id: "chat", icon: "▣", label: "Chat" },
  { id: "tasks", icon: "≡", label: "Tasks" },
  { id: "agents", icon: "◆", label: "Agents" },
  { id: "memory", icon: "✦", label: "Memory" },
  { id: "settings", icon: "⚙", label: "Setup" },
];

/**
 * Decorative shell rail (visual parity with dashboard mock). Panel switching can be wired later.
 */
export function Sidebar({ active, compact, height }: Props) {
  return (
    <Box
      flexDirection="column"
      width={compact ? 3 : 14}
      height={height}
      overflowY="hidden"
      borderStyle="single"
      borderColor="cyan"
      paddingY={1}
      paddingX={compact ? 0 : 1}
      justifyContent="flex-start"
    >
      <Text bold color="cyan" dimColor={active !== "chat"}>
        {compact ? "▣" : " liminal "}
      </Text>
      <Box marginY={1} />
      {ROWS.map((row) => {
        const on = active === row.id;
        return (
          <Box key={row.id} marginY={0}>
            <Text color={on ? "cyan" : "gray"} bold={on} dimColor={!on}>
              {compact ? row.icon : `${row.icon} ${row.label}`}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
