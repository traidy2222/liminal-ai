import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsFieldRow } from "./SettingsModal.js";

test("ASR preferences retain a labelled custom provider model entry", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsFieldRow, {
    field: { key: "AGENT_TRANSCRIBE_MODEL", label: "Transcription mode", description: "", valueKind: "enum", enumValues: ["local/whisper-large-v3-turbo", "local/qwen3-asr-1.7b"], lockedByEnv: false, resolutionSource: "product_default", effectiveDisplay: "local/whisper-large-v3-turbo", value: "local/whisper-large-v3-turbo", tabId: "session_ui", subgroupId: "voice", subgroupLabel: "Voice", productDefault: "local/whisper-large-v3-turbo" },
    rawValue: "local/whisper-large-v3-turbo", disabled: false, onChange: () => {},
  }));
  assert.match(html, /aria-label="Custom transcription model"/);
});
