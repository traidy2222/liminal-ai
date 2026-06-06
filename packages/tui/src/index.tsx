import "./tuiWorkspaceBootstrap.js";
import React, { useEffect, useState } from "react";
import { render } from "ink";
import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfigWithInference,
  resolveInferenceMode,
  hasLocalProviderApiKey,
  resolveLicenseTokenForHarness,
  loadRuntimePreferences,
  resolveWorkspaceRoot,
  saveRuntimePreferences,
  resolveHarnessEnvRaw,
  resolveChatBoot,
  saveLastActiveChatId,
  loadChatTranscriptFromSessionLog,
  conversationEntriesForHydration,
  runWithWorkspaceRoot,
  type ChatMetadata,
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
const inferenceMode = resolveInferenceMode(runtimePreferences);
if (
  (inferenceMode === "managed" || inferenceMode === "auto") &&
  !hasLocalProviderApiKey()
) {
  const license = await resolveLicenseTokenForHarness();
  if (!license) {
    console.error(
      "No Vireon account on this machine. Run: liminal login\n" +
        "Or set AGENT_API_KEY in .env for bring-your-own-key mode (AGENT_INFERENCE_MODE=byok)."
    );
    process.exit(1);
  }
}
let provider;
try {
  provider = await resolveProviderConfigWithInference(
    runtimePreferences?.provider,
    runtimePreferences
  );
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const workspaceRoot = resolveWorkspaceRoot();
const { meta: chatMeta } = await resolveChatBoot({ defaultWorkspaceRoot: workspaceRoot });
await saveLastActiveChatId(chatMeta.chatId);

const harness = runWithWorkspaceRoot(chatMeta.workspaceRoot, () =>
  new AgentHarness({
    openRouterApiKey: provider.apiKey,
    model: provider.model,
    baseURL: provider.baseURL,
    taskId: chatMeta.chatId,
    workspaceRoot: chatMeta.workspaceRoot,
    maxToolRoundsPerTurn: 128,
    safetyJudge: resolveSafetyJudge(),
    workingStateEnabled: true,
    worldContext: resolveWorldContext(),
    runtimePreferences,
    persistRuntimePreferences: async (prefs) =>
      saveRuntimePreferences(prefs, chatMeta.workspaceRoot),
    context: {
      modelMaxTokens: 128_000,
      thresholdFraction: 0.6,
      inceptionMessages: INCEPTION_MESSAGES,
      protocolDynamicBuilder: (names, hint) =>
        buildProtocolDynamicSuffix(names, (hint ?? "any") as import("@liminal/tools").ProtocolIntentHint),
    },
  })
);

await runWithWorkspaceRoot(chatMeta.workspaceRoot, async () => {
  await registerAllTools(harness.registry, harness.emitter, harness);
});
const { wireEnterpriseWithInstall } = await import("@liminal/core");
const ee = await wireEnterpriseWithInstall({
  registry: harness.registry,
  emitter: harness.emitter,
  harness,
});
if (!ee.wired && ee.reason) {
  console.warn("[enterprise] feature wiring skipped:", ee.reason);
}
void maybeAttachSessionEventLog(harness.emitter, harness.taskId);

const replayEntries = await loadChatTranscriptFromSessionLog(chatMeta.chatId);
harness.restoreConversationFromTranscript(conversationEntriesForHydration(replayEntries));
const { replayEntriesToMessages } = await import("./replayTranscript.js");
const initialMessages = replayEntriesToMessages(replayEntries);

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
  } else if (initialMessages.length === 0) {
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
      <App harness={harness} chatMeta={chatMeta} initialMessages={initialMessages} />
    </PersonaChromeContext.Provider>
  );
}

render(<Root />);
