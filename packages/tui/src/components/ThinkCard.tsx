import React from "react";
import { Box, Text } from "ink";

interface Props {
  content: string;
}

export function ThinkCard({ content }: Props) {
  return (
    <Box paddingLeft={2} marginY={0}>
      <Text color="gray" dimColor italic>
        {"💭 "}{content}
      </Text>
    </Box>
  );
}
