import { createRequire } from "node:module";
import type OpenAI from "openai";
import type { Message } from "./types.js";

/** Rough API framing overhead per completion request. */
export const REQUEST_TOKEN_OVERHEAD = 16;

const require = createRequire(import.meta.url);

let enc: { encode: (s: string) => number[] } | null = null;

function getEncoder(): { encode: (s: string) => number[] } | null {
  if (enc) return enc;
  try {
    const mod = require("js-tiktoken") as typeof import("js-tiktoken");
    enc = mod.getEncoding("cl100k_base");
    return enc;
  } catch {
    return null;
  }
}

function messageText(m: Message): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return (m.content as Array<{ type?: string; text?: string }>)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("\n");
  }
  return "";
}

/**
 * Approximate token count for budgeting. Uses cl100k_base when js-tiktoken is installed.
 */
export function estimateMessagesTokens(messages: Message[]): number {
  const e = getEncoder();
  if (!e) {
    const chars = messages.reduce((s, m) => s + messageText(m).length, 0);
    return Math.ceil(chars / 4);
  }
  let n = 0;
  for (const m of messages) {
    n += e.encode(messageText(m)).length + 4;
  }
  return n;
}

function estimateStringTokens(text: string): number {
  const e = getEncoder();
  if (!e) return Math.ceil(text.length / 4);
  return e.encode(text).length;
}

/** Approximate token count for the OpenAI `tools` array (schemas dominate). */
export function estimateToolsTokens(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): number {
  if (!tools.length) return 0;
  try {
    return estimateStringTokens(JSON.stringify(tools));
  } catch {
    const chars = tools.reduce((s, t) => s + JSON.stringify(t).length, 0);
    return Math.ceil(chars / 4);
  }
}

/** Messages + optional tool schemas + request overhead — for pre-flight context budgeting. */
export function estimateRequestTokens(
  messages: Message[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
): number {
  const toolTokens = tools?.length ? estimateToolsTokens(tools) : 0;
  return estimateMessagesTokens(messages) + toolTokens + REQUEST_TOKEN_OVERHEAD;
}
