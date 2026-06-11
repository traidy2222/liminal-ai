import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeVisionUserContent,
  modelSupportsNativeVision,
  resolveNativeVision,
} from "./native_vision.js";
import { OPENROUTER_MODEL_SLUG } from "./provider_model_presets.js";

test("modelSupportsNativeVision honors AGENT_NATIVE_VISION_SLUGS", () => {
  const prev = process.env.AGENT_NATIVE_VISION_SLUGS;
  const prevOff = process.env.AGENT_NATIVE_VISION;
  try {
    delete process.env.AGENT_NATIVE_VISION;
    process.env.AGENT_NATIVE_VISION_SLUGS = "nex-agi/nex-n2-pro:free";
    assert.equal(modelSupportsNativeVision("nex-agi/nex-n2-pro:free"), true);
    assert.equal(modelSupportsNativeVision("deepseek/deepseek-v4-pro"), false);
    process.env.AGENT_NATIVE_VISION = "0";
    assert.equal(modelSupportsNativeVision("nex-agi/nex-n2-pro:free"), false);
  } finally {
    if (prev === undefined) delete process.env.AGENT_NATIVE_VISION_SLUGS;
    else process.env.AGENT_NATIVE_VISION_SLUGS = prev;
    if (prevOff === undefined) delete process.env.AGENT_NATIVE_VISION;
    else process.env.AGENT_NATIVE_VISION = prevOff;
  }
});

test("resolveNativeVision detects nex-n2-pro via heuristic", () => {
  const prev = process.env.AGENT_NATIVE_VISION_SLUGS;
  const prevOff = process.env.AGENT_NATIVE_VISION;
  try {
    delete process.env.AGENT_NATIVE_VISION_SLUGS;
    delete process.env.AGENT_NATIVE_VISION;
    const res = resolveNativeVision(OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE);
    assert.equal(res.enabled, true);
    assert.equal(res.source, "slug_heuristic");
  } finally {
    if (prev === undefined) delete process.env.AGENT_NATIVE_VISION_SLUGS;
    else process.env.AGENT_NATIVE_VISION_SLUGS = prev;
    if (prevOff === undefined) delete process.env.AGENT_NATIVE_VISION;
    else process.env.AGENT_NATIVE_VISION = prevOff;
  }
});

test("buildNativeVisionUserContent produces text and image_url parts", async () => {
  const parts = await buildNativeVisionUserContent("describe this", [
    {
      name: "x.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
      sizeBytes: 3,
      source: "clipboard",
    },
  ]);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.type, "text");
  assert.equal(parts[1]?.type, "image_url");
});
