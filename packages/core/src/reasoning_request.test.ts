import test from "node:test";
import assert from "node:assert/strict";
import { buildReasoningRequestParams } from "./reasoning_request.js";
import { fallbackReasoningBudget } from "./reasoning_profile.js";

test("external DeepSeek reasoning explicitly disables default hidden thinking", () => {
  for (const modelSlug of ["deepseek/deepseek-v4.1-flash-1017", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v3.2"]) {
    assert.deepEqual(buildReasoningRequestParams({ baseURL: "https://openrouter.ai/api/v1", modelSlug, surface: "external" }), { reasoning: { enabled: false } });
  }
});
test("native reasoning retains the task's effort budget", () => {
  assert.deepEqual(buildReasoningRequestParams({ baseURL: "https://openrouter.ai/api/v1", modelSlug: "deepseek/deepseek-v4.1-flash-1017", surface: "native", budget: fallbackReasoningBudget("knowledge", false) }), { reasoning: { effort: "medium" } });
});
test("external mode leaves mandatory reasoning and other compatible APIs unchanged", () => {
  for (const modelSlug of ["deepseek/deepseek-r1", "deepseek/deepseek-reasoner", "deepseek/deepseek-v3.2-speciale", "deepseek/deepseek-v4.1-flash-1017:thinking", "openai/o3", "google/gemini-3.5-flash", "local-model"]) {
    assert.deepEqual(buildReasoningRequestParams({ baseURL: "https://openrouter.ai/api/v1", modelSlug, surface: "external" }), {});
  }
  assert.deepEqual(buildReasoningRequestParams({ baseURL: "http://localhost:1234/v1", modelSlug: "deepseek/deepseek-v4.1-flash-1017", surface: "external" }), {});
});
