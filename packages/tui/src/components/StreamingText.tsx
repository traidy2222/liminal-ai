import React from "react";
import { Text } from "ink";

interface Props {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export function StreamingText({ text, color, bold, dimColor }: Props) {
  return (
    <Text color={color} bold={bold} dimColor={dimColor} wrap="wrap">
      {text}
    </Text>
  );
}
