/**
 * Composer slash commands — shared catalog, parsing, and tab-completion.
 * Used by web, desktop (Dart mirror), and TUI.
 */
import { parseReceiptSlashCommand } from "./receipt_workflow.js";

export type SlashCommandKind =
  | "receipt_workflow"
  | "attach"
  | "connect"
  | "disconnect"
  | "integrations_status"
  | "abort"
  | "help";

export interface SlashCommandDef {
  name: string;
  aliases?: readonly string[];
  summary: string;
  usage: string;
  kind: SlashCommandKind;
}

export interface SlashCompletionItem {
  label: string;
  insert: string;
  detail?: string;
  kind: "command" | "provider" | "flag";
  /** Replace token index when applying (default: current token). */
  replaceTokenIndex?: number;
}

export interface SlashInputState {
  active: boolean;
  /** Full composer text. */
  text: string;
  cursor: number;
  lineStart: number;
  lineEnd: number;
  /** Line text from lineStart..lineEnd. */
  line: string;
  /** Index of token being edited (0 = command name without /). */
  tokenIndex: number;
  /** Tokens after splitting the slash segment (token[0] is command name). */
  tokens: string[];
  /** Partial text of token at tokenIndex. */
  tokenPrefix: string;
}

export interface ParsedComposerSlash {
  kind: SlashCommandKind;
  command: string;
  args: string[];
  readOnly: boolean;
  raw: string;
  /** Receipt / free-text tail. */
  note: string;
}

export const INTEGRATION_SLASH_PROVIDERS = [
  { id: "slack", label: "Slack" },
  { id: "linear", label: "Linear" },
  { id: "notion", label: "Notion" },
  { id: "xero", label: "Xero" },
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google Workspace" },
  { id: "microsoft", label: "Microsoft 365" },
  { id: "azure", label: "Azure" },
] as const;

export type IntegrationSlashProviderId = (typeof INTEGRATION_SLASH_PROVIDERS)[number]["id"];

export const COMPOSER_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  {
    name: "receipt",
    aliases: ["receipts", "process-receipts"],
    summary: "Process attached receipt image(s) into a Xero DRAFT bill",
    usage: "/receipt [note]  (attach image first, or use Process receipts button)",
    kind: "receipt_workflow",
  },
  {
    name: "attach",
    summary: "Attach an image file from disk",
    usage: "/attach <image-path>",
    kind: "attach",
  },
  {
    name: "connect",
    summary: "Connect a hosted integration (opens browser OAuth)",
    usage: "/connect <slack|linear|notion|xero|github|google|microsoft|azure> [--read-only]",
    kind: "connect",
  },
  {
    name: "disconnect",
    summary: "Disconnect a hosted integration",
    usage: "/disconnect <provider>",
    kind: "disconnect",
  },
  {
    name: "integrations",
    aliases: ["status"],
    summary: "Show connected integrations",
    usage: "/integrations",
    kind: "integrations_status",
  },
  {
    name: "abort",
    summary: "Abort the in-flight agent turn",
    usage: "/abort",
    kind: "abort",
  },
  {
    name: "help",
    aliases: ["commands", "?"],
    summary: "List composer slash commands",
    usage: "/help",
    kind: "help",
  },
] as const;

const ALL_COMMAND_NAMES: readonly string[] = COMPOSER_SLASH_COMMANDS.flatMap((c) => [
  c.name,
  ...(c.aliases ?? []),
]);

export function resolveSlashCommandDef(name: string): SlashCommandDef | null {
  const key = name.trim().toLowerCase();
  for (const def of COMPOSER_SLASH_COMMANDS) {
    if (def.name === key) return def;
    if (def.aliases?.some((a) => a === key)) return def;
  }
  return null;
}

export function isIntegrationSlashProvider(
  value: string
): value is IntegrationSlashProviderId {
  const v = value.trim().toLowerCase();
  return INTEGRATION_SLASH_PROVIDERS.some((p) => p.id === v);
}

export function lineAtCursor(
  text: string,
  cursor: number
): { lineStart: number; lineEnd: number; line: string } {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const after = text.slice(safeCursor);
  const nl = after.indexOf("\n");
  const lineEnd = nl === -1 ? text.length : safeCursor + nl;
  return { lineStart, lineEnd, line: text.slice(lineStart, lineEnd) };
}

function tokenizeSlashLine(line: string): { slashStart: number; tokens: string[] } | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const slashStart = line.length - line.trimStart().length + line.trimStart().indexOf("/");
  const body = trimmed.slice(1);
  if (!body) return { slashStart, tokens: [""] };
  const tokens = body.split(/\s+/).filter((t, i, arr) => t.length > 0 || i < arr.length);
  return { slashStart, tokens };
}

function cursorTokenIndex(line: string, cursorInLine: number, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let pos = line.indexOf("/") + 1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const start = line.indexOf(tok, pos);
    if (start < 0) return i;
    const end = start + tok.length;
    if (cursorInLine <= end || i === tokens.length - 1) return i;
    pos = end;
  }
  return tokens.length - 1;
}

/** True when the cursor sits on a slash-command line being edited. */
export function detectSlashInput(text: string, cursor: number): SlashInputState | null {
  const { lineStart, lineEnd, line } = lineAtCursor(text, cursor);
  const parsed = tokenizeSlashLine(line);
  if (!parsed) return null;
  const cursorInLine = cursor - lineStart;
  const tokenIndex = cursorTokenIndex(line, cursorInLine, parsed.tokens);
  const tokenPrefix = parsed.tokens[tokenIndex] ?? "";
  return {
    active: true,
    text,
    cursor,
    lineStart,
    lineEnd,
    line,
    tokenIndex,
    tokens: parsed.tokens,
    tokenPrefix,
  };
}

function commandCompletions(prefix: string): SlashCompletionItem[] {
  const q = prefix.toLowerCase();
  const out: SlashCompletionItem[] = [];
  for (const def of COMPOSER_SLASH_COMMANDS) {
    const names = [def.name, ...(def.aliases ?? [])];
    for (const name of names) {
      if (!q || name.startsWith(q)) {
        out.push({
          label: `/${name}`,
          insert: name,
          detail: def.summary,
          kind: "command",
        });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function providerCompletions(prefix: string): SlashCompletionItem[] {
  const q = prefix.toLowerCase();
  return INTEGRATION_SLASH_PROVIDERS.filter(
    (p) => !q || p.id.startsWith(q) || p.label.toLowerCase().includes(q)
  ).map((p) => ({
    label: p.id,
    insert: p.id,
    detail: p.label,
    kind: "provider" as const,
  }));
}

/** Dynamic completions for the token under the cursor. */
export function listSlashCompletions(text: string, cursor: number): SlashCompletionItem[] {
  const state = detectSlashInput(text, cursor);
  if (!state) return [];

  const { tokenIndex, tokenPrefix, tokens } = state;

  if (tokenIndex === 0) {
    return commandCompletions(tokenPrefix);
  }

  const cmdDef = resolveSlashCommandDef(tokens[0] ?? "");
  if (!cmdDef) return [];

  if (
    (cmdDef.kind === "connect" || cmdDef.kind === "disconnect") &&
    tokenIndex === 1
  ) {
    return providerCompletions(tokenPrefix);
  }

  if (cmdDef.kind === "connect" && tokenIndex >= 2) {
    const q = tokenPrefix.toLowerCase();
    if (!q || "--read-only".startsWith(q)) {
      return [
        {
          label: "--read-only",
          insert: "--read-only",
          detail: "OAuth with read-only scopes",
          kind: "flag",
        },
      ];
    }
  }

  return [];
}

/** Apply a completion item — returns updated text and cursor. */
export function applySlashCompletion(
  text: string,
  cursor: number,
  item: SlashCompletionItem
): { text: string; cursor: number } {
  const state = detectSlashInput(text, cursor);
  if (!state) return { text, cursor };

  const { lineStart, lineEnd, line, tokenIndex, tokens } = state;
  const parsed = tokenizeSlashLine(line);
  if (!parsed) return { text, cursor };

  const newTokens = [...tokens];
  const idx = item.replaceTokenIndex ?? tokenIndex;
  newTokens[idx] = item.insert;

  if (idx === 0 && item.kind === "command") {
    // Ensure leading /
    const rebuilt = `/${newTokens.join(" ")}`;
    const trimmedLine = line.trimStart();
    const lead = line.slice(0, line.length - trimmedLine.length);
    const newLine = lead + rebuilt + (item.kind === "command" ? " " : "");
    const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
    const newCursor = lineStart + newLine.length;
    return { text: newText, cursor: newCursor };
  }

  newTokens[idx] = item.insert;
  const trimmedLine = line.trimStart();
  const lead = line.slice(0, line.length - trimmedLine.length);
  const rebuilt = `/${newTokens.join(" ")}`;
  const suffix = item.kind === "flag" ? "" : " ";
  const newLine = lead + rebuilt + suffix;
  const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
  const newCursor = lineStart + newLine.length;
  return { text: newText, cursor: newCursor };
}

function parseFlags(parts: string[]): { readOnly: boolean; args: string[] } {
  const readOnly = parts.includes("--read-only");
  const args = parts.filter((p) => p !== "--read-only");
  return { readOnly, args };
}

/**
 * Parse a submitted slash line. Returns null when input is not a recognized command.
 * Receipt aliases delegate to receipt_workflow parser for note extraction.
 */
export function parseComposerSlashSubmit(text: string): ParsedComposerSlash | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const receipt = parseReceiptSlashCommand(trimmed);
  if (receipt) {
    return {
      kind: "receipt_workflow",
      command: trimmed.split(/\s+/)[0]!.slice(1).toLowerCase(),
      args: [],
      readOnly: false,
      raw: trimmed,
      note: receipt.note,
    };
  }

  const parts = trimmed.split(/\s+/);
  const cmdRaw = parts[0]!.slice(1).toLowerCase();
  const def = resolveSlashCommandDef(cmdRaw);
  if (!def) return null;

  const { readOnly, args: rest } = parseFlags(parts.slice(1));

  if (def.kind === "attach") {
    let path = rest.join(" ").trim();
    if (
      (path.startsWith('"') && path.endsWith('"')) ||
      (path.startsWith("'") && path.endsWith("'"))
    ) {
      path = path.slice(1, -1).trim();
    }
    return {
      kind: "attach",
      command: def.name,
      args: path ? [path] : [],
      readOnly: false,
      raw: trimmed,
      note: "",
    };
  }

  if (def.kind === "connect" || def.kind === "disconnect") {
    const provider = rest[0]?.toLowerCase() ?? "";
    return {
      kind: def.kind,
      command: def.name,
      args: provider ? [provider] : [],
      readOnly,
      raw: trimmed,
      note: "",
    };
  }

  return {
    kind: def.kind,
    command: def.name,
    args: rest,
    readOnly,
    raw: trimmed,
    note: rest.join(" ").trim(),
  };
}

export function formatSlashHelpText(): string {
  const lines = ["Composer slash commands:"];
  for (const def of COMPOSER_SLASH_COMMANDS) {
    const aliases =
      def.aliases && def.aliases.length > 0
        ? ` (/${def.aliases.join(", /")})`
        : "";
    lines.push(`  /${def.name}${aliases} — ${def.summary}`);
    lines.push(`    ${def.usage}`);
  }
  lines.push("Tab or ↑↓ complete while typing. Type /help anytime.");
  return lines.join("\n");
}

export function slashCompletionHint(text: string, cursor: number): string | null {
  const items = listSlashCompletions(text, cursor);
  if (items.length === 0) return null;
  const top = items.slice(0, 4).map((i) => (i.detail ? `${i.label} — ${i.detail}` : i.label));
  const more = items.length > 4 ? ` (+${items.length - 4})` : "";
  return top.join(" · ") + more;
}

/** Names for tests / validation. */
export function allComposerSlashCommandNames(): readonly string[] {
  return ALL_COMMAND_NAMES;
}
