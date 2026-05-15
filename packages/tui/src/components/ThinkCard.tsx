import React from "react";
import { Box, Text } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  content: string;
}

export function ThinkCard({ content }: Props) {
  const jarvis = usePersonaChrome().colors;
  return (
    <Box paddingLeft={2} marginY={0}>
      <Text color={jarvis.muted} dimColor italic>
        {"💭 "}{content}
      </Text>
    </Box>
  );
}
