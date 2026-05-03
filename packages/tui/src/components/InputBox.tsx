import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function InputBox({ onSubmit, disabled }: Props) {
  const [input, setInput] = useState("");

  useInput(
    (char, key) => {
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
    <Box borderStyle="single" borderColor={disabled ? "gray" : "white"} paddingX={1}>
      <Text color="cyan">{">"} </Text>
      <Text color={disabled ? "gray" : "white"}>
        {disabled ? "(processing…)" : input || ""}
        {!disabled && <Text color="cyan">█</Text>}
      </Text>
    </Box>
  );
}
