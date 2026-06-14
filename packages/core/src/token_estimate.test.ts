import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import {
  estimateMessagesTokens,
  estimateRequestTokens,
  estimateToolsTokens,
} from "./token_estimate.js";
import type { Message } from "./types.js";

test("estimateToolsTokens counts large tool schemas", () => {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "x".repeat(5000) },
          },
        },
      },
    },
  ];
  const toolTokens = estimateToolsTokens(tools);
  assert.ok(toolTokens > 500);
});

test("estimateRequestTokens exceeds messages-only count when tools present", () => {
  const messages: Message[] = [{ role: "user", content: "hello" }];
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: { name: "think", description: "think", parameters: { type: "object" } },
    },
  ];
  const msgOnly = estimateMessagesTokens(messages);
  const full = estimateRequestTokens(messages, tools);
  assert.ok(full > msgOnly);
});
