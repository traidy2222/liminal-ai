import "./tuiWorkspaceBootstrap.js";
import React, { useEffect, useState } from "react";
import { render } from "ink";
import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfig,
  loadRuntimePreferences,
  resolveWorkspaceRoot,
  saveRuntimePreferences,
  resolveHarnessEnvRaw,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  applyPersonaProfileToHarness,
  loadPersonaUiThemeFromWorkspace,
} from "@liminal/tools";
import { App } from "./App.js";
import { PersonaChromeContext, buildChromeFromTheme } from "./personaChromeContext.js";

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
    thresholdFraction: 0.6,
    inceptionMessages: INCEPTION_MESSAGES,
    protocolDynamicBuilder: (names, hint) => buildProtocolDynamicSuffix(names, (hint ?? "any") as import("@liminal/tools").ProtocolIntentHint),
  },
});

await registerAllTools(harness.registry, harness.emitter, harness);
void maybeAttachSessionEventLog(harness.emitter, harness.taskId);

try {
  const persisted = harness.getPersistedPersonaProfile();
  if (persisted) {
    await applyPersonaProfileToHarness(harness, persisted);
  }
  const prefs = harness.getRuntimePreferences();
  const bootstrapOn =
    resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) !== "0";
  const forceBootstrap = process.env["AGENT_PERSONA_BOOTSTRAP_FORCE"] === "1";
  const needBootstrapOverlay =
    bootstrapOn && (forceBootstrap || !harness.isPersonaBootstrapCompleted());
  if (needBootstrapOverlay) {
    // Web parity: dedicated overlay in App; no in-chat model bootstrap turn here.
  } else {
    await harness.sendSessionGreeting();
  }
} catch (err) {
  console.error("Session greeting failed:", err instanceof Error ? err.message : String(err));
}

function Root() {
  const [chrome, setChrome] = useState(() => buildChromeFromTheme(null));
  useEffect(() => {
    void loadPersonaUiThemeFromWorkspace().then((t) => {
      setChrome(buildChromeFromTheme(t));
    });
  }, []);
  return (
    <PersonaChromeContext.Provider value={chrome}>
      <App harness={harness} />
    </PersonaChromeContext.Provider>
  );
}

render(<Root />);
