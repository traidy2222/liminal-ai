import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  content: string;
  streaming?: boolean;
  tool_families?: string[];
  scope?: string;
  unknowns?: string[];
  clarification_needed?: boolean;
  clarification_question?: string;
  self_check?: number;
}

export function ThinkCard({
  content,
  streaming,
  tool_families,
  scope,
  unknowns,
  clarification_needed,
  clarification_question,
  self_check,
}: Props) {
  const jarvis = usePersonaChrome().colors;
  const hasStructured =
    (tool_families && tool_families.length > 0) ||
    scope ||
    (unknowns && unknowns.length > 0) ||
    clarification_needed ||
    self_check !== undefined;

  return (
    <Box flexDirection="column" paddingLeft={2} marginY={0}>
      <Text color={jarvis.muted} dimColor italic>
        {"💭 "}
        {streaming && content.length > 400 ? "…" + content.slice(-400) : content}
        {streaming ? "▍" : ""}
      </Text>
      {hasStructured && (
        <Box flexDirection="column" paddingLeft={2} marginTop={0}>
          {scope && (
            <Text color={jarvis.muted} dimColor>
              {"scope: "}{scope}
            </Text>
          )}
          {tool_families && tool_families.length > 0 && (
            <Text color={jarvis.muted} dimColor>
              {"families: "}{tool_families.join(", ")}
            </Text>
          )}
          {unknowns && unknowns.length > 0 && (
            <Text color={jarvis.muted} dimColor>
              {"unknowns: "}{unknowns.join(" · ")}
            </Text>
          )}
          {clarification_needed && clarification_question && (
            <Text color={jarvis.accent} dimColor>
              {"❓ "}{clarification_question}
            </Text>
          )}
          {self_check !== undefined && (
            <Text color={self_check >= 80 ? jarvis.assistant : jarvis.warn} dimColor>
              {"self-check: "}{String(self_check)}{"/100"}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
