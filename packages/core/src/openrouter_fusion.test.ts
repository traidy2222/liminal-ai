import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPENROUTER_FUSION_MODEL_SLUG,
  buildOpenRouterFusionPlugin,
  buildOpenRouterFusionRequestExtras,
  isOpenRouterFusionModel,
  isOpenRouterRouterModel,
} from "./openrouter_fusion.js";

describe("openrouter_fusion", () => {
  it("detects fusion slug", () => {
    assert.equal(isOpenRouterFusionModel(OPENROUTER_FUSION_MODEL_SLUG), true);
    assert.equal(isOpenRouterFusionModel("deepseek/deepseek-v4-pro"), false);
  });

  it("treats fusion as a router model", () => {
    assert.equal(isOpenRouterRouterModel(OPENROUTER_FUSION_MODEL_SLUG), true);
    assert.equal(isOpenRouterRouterModel("deepseek/deepseek-v4-pro"), false);
  });

  it("builds plugin with analysis_models and judge", () => {
    const p = buildOpenRouterFusionPlugin({ preset: "budget" });
    assert.equal(p.id, "fusion");
    assert.ok(p.analysis_models.length >= 2 && p.analysis_models.length <= 8);
    assert.ok(typeof p.model === "string" && p.model.length > 0);
    assert.ok(p.max_tool_calls != null && p.max_tool_calls >= 1);
  });

  it("attaches plugins only for fusion on OpenRouter base", () => {
    const extras = buildOpenRouterFusionRequestExtras({
      baseURL: "https://openrouter.ai/api/v1",
      modelSlug: OPENROUTER_FUSION_MODEL_SLUG,
    });
    assert.ok("plugins" in extras);
    assert.equal(extras.plugins?.[0]?.id, "fusion");
    assert.deepEqual(
      buildOpenRouterFusionRequestExtras({
        baseURL: "https://openrouter.ai/api/v1",
        modelSlug: "deepseek/deepseek-v4-pro",
      }),
      {}
    );
  });
});
