import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Ctrl+N — clear harness transcript when idle (same as web “New session”). */
  onNewSession?: () => void;
  /** Left prompt label (dashboard-style). */
  promptLabel?: string;
}

export function InputBox({ onSubmit, disabled, onNewSession, promptLabel = "liminal" }: Props) {
  const [input, setInput] = useState("");

  useInput(
    (char, key) => {
      if (key.ctrl && (char === "n" || char === "N") && onNewSession && !disabled) {
        onNewSession();
        setInput("");
        return;
      }
      if (key.return) {
        if (input.trim()) {
          onSubmit(input.trim());
          setInput("");
        }
      } else if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        setInput((s) => s + char);
      }
    },
    { isActive: !disabled }
  );

  return (
    <Box borderStyle="single" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
      <Text color="cyan" bold>
        {promptLabel}
        {" > "}
      </Text>
      <Text color={disabled ? "gray" : "white"}>
        {disabled ? "(processing…)" : input || ""}
        {!disabled && <Text color="cyan">█</Text>}
      </Text>
      {onNewSession && !disabled && (
        <Text dimColor color="gray">
          {" "}
          ^N new session
        </Text>
      )}
    </Box>
  );
}
