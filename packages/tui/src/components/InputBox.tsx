import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePersonaChrome } from "../personaChromeContext.js";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Ctrl+N — clear harness transcript when idle (same as web “New session”). */
  onNewSession?: () => void;
  /** Left prompt label (dashboard-style). */
  promptLabel?: string;
}

export function InputBox({ onSubmit, disabled, onNewSession, promptLabel = "liminal" }: Props) {
  const jarvis = usePersonaChrome().colors;
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
    <Box borderStyle="single" borderColor={disabled ? jarvis.muted : jarvis.accent} paddingX={1}>
      <Text color={jarvis.accent} bold>
        {promptLabel}
        {" > "}
      </Text>
      <Text color={disabled ? jarvis.muted : jarvis.body}>
        {disabled ? "(processing…)" : input || ""}
        {!disabled && <Text color={jarvis.accent}>█</Text>}
      </Text>
      {onNewSession && !disabled && (
        <Text dimColor color={jarvis.muted}>
          {" "}
          ^N new session
        </Text>
      )}
    </Box>
  );
}
