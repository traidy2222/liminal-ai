import test from "node:test";
import assert from "node:assert/strict";
import { buildDesktopConfig } from "./sidecar_api.js";
import type { SessionBridge } from "./session_bridge.js";

test("desktop wake listening survives selecting a chat with an older disabled snapshot", async () => {
  const old = process.env.AGENT_WAKE_WORD_ENABLED;
  delete process.env.AGENT_WAKE_WORD_ENABLED;
  try {
    const bridge = {
      isAwaitingPersonaBootstrap: false,
      harness: {
        getRuntimePreferences: () => ({version:1,updatedAt:0,harness:{env:{AGENT_WAKE_WORD_ENABLED:"0"}}}),
        getCurrentPersona: () => undefined,
        config: {openRouterApiKey:"",model:"dummy",baseURL:"https://example.invalid/v1"},
      },
    } as unknown as SessionBridge;
    const config = await buildDesktopConfig(bridge, process.cwd(), {
      wakePreferences: {version:1,updatedAt:1,harness:{env:{AGENT_WAKE_WORD_ENABLED:"1"}}},
    });
    assert.equal(config.wakeVoice.enabled, true);
    const disabled = await buildDesktopConfig(bridge, process.cwd(), {
      wakePreferences: {version:1,updatedAt:2,harness:{env:{AGENT_WAKE_WORD_ENABLED:"0"}}},
    });
    assert.equal(disabled.wakeVoice.enabled, false, "explicitly disabling the global listener still works");
  } finally {
    if(old===undefined)delete process.env.AGENT_WAKE_WORD_ENABLED;
    else process.env.AGENT_WAKE_WORD_ENABLED=old;
  }
});
