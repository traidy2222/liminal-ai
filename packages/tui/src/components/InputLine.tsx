import React from "react";
import { Box, Text } from "ink";
import type { ImageAttachment } from "@liminal/core";

interface Props {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  busy: boolean;
  scrollOffset: number;
  attachments: ImageAttachment[];
  status: string | null;
  width: number;
}

export function InputLine({
  lines,
  cursorRow,
  cursorCol,
  busy,
  scrollOffset,
  attachments,
  status,
  width,
}: Props) {
  const hints =
    scrollOffset > 0
      ? "Esc=bottom  ↑↓=scroll  /attach <path>  ^K=draft  ^L=session"
      : "↑↓=scroll  Shift+Enter=newline  /attach <path>  ^K=draft  ^L=session";

  // Reserve space for hints on the right (only on wide terminals)
  const hintText = width >= 70 ? hints : "";
  const promptPrefix = "> ";
  const maxInput = width - promptPrefix.length - hintText.length - 3;
  const safeRow = Math.max(0, Math.min(cursorRow, lines.length - 1));
  const safeCol = Math.max(0, Math.min(cursorCol, lines[safeRow]?.length ?? 0));
  const displayLines = lines.slice(Math.max(0, lines.length - 4));
  const rowOffset = Math.max(0, lines.length - displayLines.length);

  return (
    <Box flexDirection="column" width={width}>
      {attachments.length > 0 && (
        <Box width={width} paddingX={1}>
          <Text color="cyan">
            attached: {attachments.map((a) => a.name).join(", ")}
          </Text>
        </Box>
      )}
      {status && (
        <Box width={width} paddingX={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      )}
      {displayLines.map((line, idx) => {
        const sourceRow = rowOffset + idx;
        const isCursorRow = sourceRow === safeRow;
        const clipped =
          line.length > maxInput ? "…" + line.slice(-(maxInput - 1)) : line;
        let rowText = clipped;
        let cursorIndex = Math.min(safeCol, rowText.length);
        if (line.length > maxInput && isCursorRow) {
          const hidden = line.length - (maxInput - 1);
          cursorIndex = Math.max(0, Math.min(maxInput, safeCol - hidden + 1));
        }
        return (
          <Box key={sourceRow} width={width} paddingX={1} gap={0}>
            <Text color={busy ? "gray" : "cyan"} bold>{sourceRow === 0 ? ">" : "·"} </Text>
            {busy ? (
              <Text color="gray">{sourceRow === 0 ? "processing…" : ""}</Text>
            ) : isCursorRow ? (
              <>
                <Text color="white">{rowText.slice(0, cursorIndex)}</Text>
                <Text color="cyan">█</Text>
                <Text color="white">{rowText.slice(cursorIndex)}</Text>
              </>
            ) : (
              <Text color="white">{rowText}</Text>
            )}
            {sourceRow === 0 && hintText && (
              <Box flexGrow={1} justifyContent="flex-end">
                <Text dimColor color="gray">{hintText}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
