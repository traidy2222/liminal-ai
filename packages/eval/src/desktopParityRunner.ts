/**
 * Desktop-parity eval runner — same stack path as liminald (ChatRegistry + SessionBridge).
 */
import { randomBytes } from "node:crypto";
import {
  AgentHarness,
  loadRuntimePreferences,
  maybeAttachSessionEventLog,
  runWithWorkspaceRoot,
  type AgentConfig,
  type AgentEventMap,
  type ProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";
import {
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  registerAllTools,
  type ProtocolIntentHint,
} from "@liminal/tools";
import type { ServerFrame } from "@liminal/protocol";
import { SessionBridge } from "../../sidecar/src/session_bridge.js";
import {
  applyDesktopSidecarBootEnv,
  DESKTOP_PARITY_HARNESS_SNAPSHOT,
  desktopParityLabEnv,
} from "./desktopParityBootstrap.js";
import {
  applyEvalModelEnv,
  mergeEvalManagedEnv,
  resolveEvalProvider,
} from "./evalProvider.js";
import { prepareSandboxLab } from "./sandboxLabBootstrap.js";
import type { Scenario, TraceEvent } from "./runner.js";

export interface DesktopParityRunMeta {
  profile: "desktop";
  model: string;
  bridgeFrames: number;
  approvalPrompts: number;
  harness: typeof DESKTOP_PARITY_HARNESS_SNAPSHOT;
}

function makeDesktopParityConfig(
  provider: ProviderConfig,
  chatId: string,
  workspaceRoot: string,
  runtimePreferences: RuntimePreferences | null,
  maxRounds: number
): AgentConfig {
  return {
    openRouterApiKey: provider.apiKey,
    model: provider.model,
    baseURL: provider.baseURL,
    taskId: chatId,
    workspaceRoot,
    maxToolRoundsPerTurn: maxRounds,
    workingStateEnabled: true,
    runtimePreferences,
    context: {
      modelMaxTokens: DESKTOP_PARITY_HARNESS_SNAPSHOT.modelMaxTokens,
      thresholdFraction: DESKTOP_PARITY_HARNESS_SNAPSHOT.thresholdFraction,
      inceptionMessages: INCEPTION_MESSAGES,
      protocolDynamicBuilder: (names, hint, registry) =>
        buildProtocolDynamicSuffix(names, (hint ?? "any") as ProtocolIntentHint, registry),
      compressionGuideline:
        "Preserve file paths, error codes, and user-stated constraints when summarizing older tool rounds.",
    },
  };
}

const CAPTURED_EVENTS = [
  "text",
  "tool_start",
  "tool_delta",
  "tool_result",
  "turn_end",
  "error",
  "context_compressed",
  "tool_timing",
  "subtask_spawned",
  "subtask_complete",
  "execution_state",
  "contract_transition",
  "contract_violation",
  "recovery_action",
  "drift_detected",
  "runtime_heartbeat",
  "approval_decision",
  "provider_retry",
] as const satisfies ReadonlyArray<keyof AgentEventMap>;

export async function runDesktopParitySend(
  scenario: Scenario,
  userMessage: string,
  opts?: { provider?: ProviderConfig; runtimePreferences?: RuntimePreferences | null }
): Promise<{
  trace: TraceEvent[];
  runError?: string;
  durationMs: number;
  sandboxRoot?: string;
  sandboxCleanup?: () => void;
  modelSlug?: string;
  parityMeta: DesktopParityRunMeta;
}> {
  if (!scenario.sandboxFixture) {
    throw new Error("desktop parity runs require scenario.sandboxFixture");
  }

  const t0 = Date.now();
  const trace: TraceEvent[] = [];
  const session = prepareSandboxLab(scenario.sandboxFixture);
  const workspaceRoot = session.root;

  const envPatches = mergeEvalManagedEnv({
    ...desktopParityLabEnv(workspaceRoot),
    ...(scenario.env ?? {}),
  });

  applyDesktopSidecarBootEnv();
  process.env["EVAL_DESKTOP_PARITY"] = "1";

  const prevEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envPatches)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  applyEvalModelEnv();

  const bridgeFrames: ServerFrame[] = [];
  let approvalPrompts = 0;
  let bridge: SessionBridge | undefined;

  try {
    const runtimePreferences =
      opts?.runtimePreferences ?? (await loadRuntimePreferences(workspaceRoot));
    const provider = opts?.provider ?? (await resolveEvalProvider(runtimePreferences));

    const chatId = `eval_desktop_${randomBytes(6).toString("hex")}`;
    const harness = runWithWorkspaceRoot(workspaceRoot, () =>
      new AgentHarness(
        makeDesktopParityConfig(
          provider,
          chatId,
          workspaceRoot,
          runtimePreferences,
          scenario.maxRounds ?? DESKTOP_PARITY_HARNESS_SNAPSHOT.maxToolRoundsPerTurn
        )
      )
    );

    maybeAttachSessionEventLog(harness.emitter, harness.taskId);

    await runWithWorkspaceRoot(workspaceRoot, async () => {
      await registerAllTools(harness.registry, harness.emitter, harness);
    });

    for (const evName of CAPTURED_EVENTS) {
      harness.emitter.on(evName, (payload) => {
        trace.push({ type: evName, payload, at: Date.now() });
      });
    }

    bridge = new SessionBridge(harness, chatId, workspaceRoot, (frame) => {
      bridgeFrames.push(frame);
      if (frame.event === "tool_approval") {
        approvalPrompts += 1;
        const data = frame.data as {
          callId: string;
          approvalNonce: string;
        };
        bridge!.resolveApproval(data.callId, { decision: "approve" }, data.approvalNonce);
      }
      if (frame.event === "ask_user") {
        bridge!.resolveAskUser("(desktop-parity eval auto-answer)");
      }
    });

    await runWithWorkspaceRoot(workspaceRoot, async () => {
      await bridge!.beginSession();
      await bridge!.sendUserMessage(userMessage);
    });

    return {
      trace,
      durationMs: Date.now() - t0,
      sandboxRoot: workspaceRoot,
      sandboxCleanup: () => session.cleanup(),
      modelSlug: provider.model,
      parityMeta: {
        profile: "desktop",
        model: provider.model,
        bridgeFrames: bridgeFrames.length,
        approvalPrompts,
        harness: DESKTOP_PARITY_HARNESS_SNAPSHOT,
      },
    };
  } catch (err) {
    const runError = err instanceof Error ? err.message : String(err);
    trace.push({ type: "error", payload: { err: { message: runError } }, at: Date.now() });
    return {
      trace,
      runError,
      durationMs: Date.now() - t0,
      sandboxRoot: workspaceRoot,
      sandboxCleanup: () => session.cleanup(),
      parityMeta: {
        profile: "desktop",
        model: process.env["AGENT_MODEL"] ?? "?",
        bridgeFrames: bridgeFrames.length,
        approvalPrompts,
        harness: DESKTOP_PARITY_HARNESS_SNAPSHOT,
      },
    };
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env["EVAL_DESKTOP_PARITY"];
  }
}
