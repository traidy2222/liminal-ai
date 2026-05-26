import React from "react";
import { ChatSwitcher } from "./ChatSwitcher.js";

/** Inline chat picker — lives inside each shell's title/chrome row, not a separate strip. */
export function ShellChatSwitcher() {
  return <ChatSwitcher layout="inline" />;
}
