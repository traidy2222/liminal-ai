/**
 * Terminal palette aligned with web JARVIS HUD.
 * Ink renders most reliably with named colors across terminals; web uses hex — map there, not here.
 */
export const jarvis = {
  accent: "cyan" as const,
  userMark: "cyan" as const,
  assistant: "green" as const,
  warn: "yellow" as const,
  danger: "red" as const,
  meta: "magenta" as const,
  muted: "gray" as const,
  body: "white" as const,
  borderStrong: "cyan" as const,
  borderSoft: "gray" as const,
};
