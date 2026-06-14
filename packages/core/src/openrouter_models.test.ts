import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOpenRouterModelCatalog,
  parseOpenRouterModelLimits,
} from "./openrouter_models.js";

test("parseOpenRouterModelLimits uses min of model and top_provider context", () => {
  const limits = parseOpenRouterModelLimits({
    id: "openai/gpt-4",
    context_length: 128_000,
    top_provider: { context_length: 8192, max_completion_tokens: 4096 },
  });
  assert.ok(limits);
  assert.equal(limits!.contextLength, 8192);
  assert.equal(limits!.maxCompletionTokens, 4096);
});

test("parseOpenRouterModelCatalog indexes by slug", () => {
  const catalog = parseOpenRouterModelCatalog({
    data: [
      {
        id: "deepseek/deepseek-v4-pro",
        context_length: 128_000,
        top_provider: { max_completion_tokens: 8192 },
      },
    ],
  });
  assert.equal(catalog.get("deepseek/deepseek-v4-pro")?.contextLength, 128_000);
  assert.equal(catalog.get("deepseek/deepseek-v4-pro")?.maxCompletionTokens, 8192);
});
