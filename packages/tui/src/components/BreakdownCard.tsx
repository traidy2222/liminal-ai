import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

const SCOPE_ICON: Record<string, string> = {
  read_only: "◌",
  additive: "+",
  mutating: "~",
  destructive: "!",
};

const STRATEGY_LABEL: Record<string, string> = {
  direct: "direct",
  research_first: "research → act",
  plan_then_execute: "plan → execute",
  clarify_first: "clarify first",
  parallel_branches: "parallel branches",
};

interface Part {
  id: string;
  description: string;
  parallel: boolean;
}

interface Props {
  goal: string;
  request_type: string;
  parts: Part[];
  unknowns: string[];
  tool_families: string[];
  strategy: string;
  scope: string;
  complexity: string;
  clarification_needed: boolean;
  clarification_question?: string;
}

export function BreakdownCard({
  goal,
  request_type,
  parts,
  unknowns,
  tool_families,
  strategy,
  scope,
  complexity,
  clarification_needed,
  clarification_question,
}: Props) {
  const { colors: c } = usePersonaChrome();
  const scopeIcon = SCOPE_ICON[scope] ?? "?";
  const stratLabel = STRATEGY_LABEL[strategy] ?? strategy;

  return (
    <Box flexDirection="column" paddingLeft={2} marginY={0}>
      {/* Header row */}
      <Box gap={1}>
        <Text color={c.accent} bold>⊛ Breakdown</Text>
        <Text color={c.muted} dimColor>
          {`${request_type} · ${stratLabel} · ${scopeIcon} ${scope} · ${complexity}`}
        </Text>
      </Box>

      {/* Goal */}
      <Box paddingLeft={2}>
        <Text color={c.assistant} wrap="wrap">{goal}</Text>
      </Box>

      {/* Parts */}
      {parts.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {parts.map((p) => (
            <Box key={p.id} gap={1}>
              <Text color={c.muted} dimColor>{p.parallel ? "⇉" : "→"}</Text>
              <Text color={c.muted} dimColor wrap="wrap">
                {`[${p.id}] ${p.description}`}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Unknowns */}
      {unknowns.length > 0 && (
        <Box paddingLeft={2} gap={1}>
          <Text color={c.meta} dimColor>{"? "}</Text>
          <Text color={c.meta} dimColor wrap="wrap">{unknowns.join(" · ")}</Text>
        </Box>
      )}

      {/* Tool families */}
      {tool_families.length > 0 && (
        <Box paddingLeft={2} gap={1}>
          <Text color={c.muted} dimColor>{"▸ "}</Text>
          <Text color={c.muted} dimColor>{tool_families.join(", ")}</Text>
        </Box>
      )}

      {/* Clarification */}
      {clarification_needed && clarification_question && (
        <Box paddingLeft={2} gap={1}>
          <Text color="yellow" bold>{"⚠ "}</Text>
          <Text color="yellow" wrap="wrap">{clarification_question}</Text>
        </Box>
      )}
    </Box>
  );
}
