import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferManagedModelFamily,
  managedModelFamilyLabel,
  resolveManagedModelFamily,
} from "./managed_model_family.js";

describe("managed_model_family", () => {
  it("maps Bedrock provider prefixes", () => {
    assert.equal(inferManagedModelFamily("deepseek.v3.2"), "deepseek");
    assert.equal(inferManagedModelFamily("qwen.qwen3-235b-a22b"), "qwen");
    assert.equal(inferManagedModelFamily("moonshotai.kimi-k2"), "moonshotai");
    assert.equal(inferManagedModelFamily("us.anthropic.claude-sonnet-4-6"), "anthropic");
    assert.equal(inferManagedModelFamily("mistral.ministral-3-3b-instruct"), "mistral");
    assert.equal(inferManagedModelFamily("google.gemma-3-27b-it"), "google");
    assert.equal(inferManagedModelFamily("nvidia.nemotron-nano-12b-v2"), "nvidia");
    assert.equal(inferManagedModelFamily("ai21.jamba-instruct-v1:0"), "ai21");
  });

  it("overrides upstream other when id is recognizable", () => {
    assert.equal(resolveManagedModelFamily("deepseek.v3.2", "other"), "deepseek");
    assert.equal(resolveManagedModelFamily("deepseek.v3.2", "anthropic"), "deepseek");
    assert.equal(resolveManagedModelFamily("unknown-model", "cohere"), "cohere");
  });

  it("labels families for UI grouping", () => {
    assert.equal(managedModelFamilyLabel("deepseek"), "DeepSeek");
    assert.equal(managedModelFamilyLabel("moonshotai"), "Moonshot AI");
    assert.equal(managedModelFamilyLabel("other"), "Other");
  });
});
