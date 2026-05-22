import type { CSSProperties } from "react";
import { LIM } from "./personaVars.js";

/** Markdown element styles driven by persona semantic CSS variables. */
export const personaMarkdownStyles = {
  paragraph: { margin: "0 0 10px", whiteSpace: "normal" as const, lineHeight: 1.72 },
  h1: {
    fontSize: 22,
    margin: "18px 0 10px",
    color: LIM.markdownH1,
    borderBottom: "1px solid rgba(var(--lim-success-rgb),0.15)",
    paddingBottom: 5,
    fontWeight: 700,
  },
  h2: { fontSize: 18, margin: "16px 0 8px", color: LIM.markdownH2, fontWeight: 700 },
  h3: { fontSize: 15, margin: "12px 0 6px", color: LIM.secondary, fontWeight: 600 },
  inlineCode: {
    background: LIM.codeBg,
    border: "1px solid rgba(var(--lim-accent-rgb),0.12)",
    borderRadius: 3,
    padding: "1px 5px",
    color: LIM.success,
    fontFamily: LIM.fontMono,
    fontSize: "0.9em",
  },
  quote: {
    margin: "12px 0",
    padding: "8px 14px",
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.25)",
    color: LIM.textMuted,
    fontStyle: "italic" as const,
    background: "rgba(0,10,20,0.5)",
    borderRadius: "0 4px 4px 0",
  },
} satisfies Record<string, CSSProperties>;
