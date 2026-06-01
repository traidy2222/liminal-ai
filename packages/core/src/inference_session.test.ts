import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearManagedInferenceSessionCache,
  isManagedInferenceBaseUrl,
} from "./inference_session.js";

describe("inference_session", () => {
  it("detects managed base URLs", () => {
    assert.equal(isManagedInferenceBaseUrl("https://api.vireondynamics.com/v1/inference"), true);
    assert.equal(isManagedInferenceBaseUrl("https://openrouter.ai/api/v1"), false);
  });

  it("clears cache without throw", () => {
    clearManagedInferenceSessionCache();
  });
});
