import React from "react";
import { Box, Text } from "ink";

interface Props {
  value: string;
  busy: boolean;
  scrollOffset: number;
  width: number;
}

export function InputLine({ value, busy, scrollOffset, width }: Props) {
  const hints =
    scrollOffset > 0
      ? "Esc=bottom  ↑↓=scroll  ^K=clear  ^C=exit"
      : "↑↓=scroll  ^K=clear  ^C=exit";

  // Reserve space for hints on the right (only on wide terminals)
  const hintText = width >= 70 ? hints : "";
  const promptPrefix = "> ";
  const maxInput = width - promptPrefix.length - hintText.length - 3;

  const displayInput =
    value.length > maxInput ? "…" + value.slice(-(maxInput - 1)) : value;

  return (
    <Box width={width} paddingX={1} gap={0}>
      <Text color={busy ? "gray" : "cyan"} bold>{">"} </Text>
      {busy ? (
        <Text color="gray">processing…</Text>
      ) : (
        <>
          <Text color="white">{displayInput}</Text>
          <Text color="cyan">█</Text>
        </>
      )}
      {hintText && (
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor color="gray">{hintText}</Text>
        </Box>
      )}
    </Box>
  );
}
