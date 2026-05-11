import "./tuiWorkspaceBootstrap.js";
import React from "react";
import { render } from "ink";
import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfig,
  loadRuntimePreferences,
  resolveWorkspaceRoot,
  saveRuntimePreferences,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  applyPersonaProfileToHarness,
} from "@liminal/tools";
import { App } from "./App.js";

/** Heuristic + LLM 0/1 gate to skip approval on safe calls. Env: AGENT_SAFETY_JUDGE=1 */
function resolveSafetyJudge():
  | { enabled: true; model?: string }
  | undefined {
  if (process.env["AGENT_SAFETY_JUDGE"] !== "1") return undefined;
  const model = process.env["AGENT_SAFETY_JUDGE_MODEL"]?.trim();
  return {
    enabled: true,
    ...(model ? { model } : {}),
  };
}

function resolveWorldContext():
  | { location: string; sessionMode?: "initializer" | "coding" }
  | { sessionMode: "initializer" | "coding" }
  | undefined {
  const loc = process.env["AGENT_LOCATION"]?.trim();
  const modeRaw = process.env["AGENT_SESSION_MODE"]?.trim().toLowerCase();
  const sessionMode =
    modeRaw === "initializer" || modeRaw === "coding" ? modeRaw : undefined;
  if (!loc && !sessionMode) return undefined;
  if (loc && sessionMode) return { location: loc, sessionMode };
  if (loc) return { location: loc };
  return { sessionMode: sessionMode! };
}

if (!process.env["AGENT_DESTRUCTIVE_GATE"]) {
  process.env["AGENT_DESTRUCTIVE_GATE"] = "balanced";
}
const runtimePreferences = await loadRuntimePreferences(resolveWorkspaceRoot());
let provider;
try {
  provider = resolveProviderConfig(runtimePreferences?.provider);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const harness = new AgentHarness({
  openRouterApiKey: provider.apiKey,
  model: provider.model,
  baseURL: provider.baseURL,
  maxToolRoundsPerTurn: 128,
  safetyJudge: resolveSafetyJudge(),
  workingStateEnabled: true,
  // World context: auto-gather date/time/OS/shell; optionally include location
  // Set AGENT_LOCATION="City, Country" in .env to include physical location
  worldContext: resolveWorldContext(),
  runtimePreferences,
  persistRuntimePreferences: async (prefs) =>
    saveRuntimePreferences(prefs, resolveWorkspaceRoot()),
  context: {
    modelMaxTokens: 128_000,
    thresholdFraction: 0.8,
    inceptionMessages: INCEPTION_MESSAGES,
    protocolDynamicBuilder: (names) => buildProtocolDynamicSuffix(names),
  },
});

await registerAllTools(harness.registry, harness.emitter, harness);
void maybeAttachSessionEventLog(harness.emitter, harness.taskId);

try {
  const persisted = harness.getPersistedPersonaProfile();
  if (persisted) {
    await applyPersonaProfileToHarness(harness, persisted);
  }
  if (process.env["AGENT_PERSONA_BOOTSTRAP"] !== "0" && !harness.isPersonaBootstrapCompleted()) {
    await harness.sendPersonaBootstrapPrompt();
  } else {
    await harness.sendSessionGreeting();
  }
} catch (err) {
  console.error("Session greeting failed:", err instanceof Error ? err.message : String(err));
}

render(<App harness={harness} />);
