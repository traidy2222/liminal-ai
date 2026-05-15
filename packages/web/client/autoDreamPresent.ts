/**
 * User-facing copy for background memory consolidation ("Auto-Dream") telemetry.
 * Keeps raw harness fields out of the default UI; use `technical` for support/debug.
 */
import type { AutoDreamState } from "./useSSE.js";

export const MEMORY_SYNC_LABEL = "MEMORY SYNC";

export type PresentedAutoDreamStatus = "off" | "idle" | "running" | "done" | "failed";

export interface PresentedAutoDream {
  status: PresentedAutoDreamStatus;
  title: string;
  subtitle?: string;
  /** 0–4 for fixed pipeline steps; omit when unknown */
  progressStepIndex?: number;
  /** True during gate / early prep without a known step */
  progressIndeterminate?: boolean;
  /** Collapsed technical block (JSON-ish lines) */
  technical: string;
  /** Short line for narrow header pill */
  pillHeadline: string;
}

function gateUserLine(name: string, passed: boolean, reason?: string): string {
  const waiting = (hint: string) => (passed ? hint : `Not yet: ${hint}`);
  switch (name) {
    case "enabled":
      return passed ? "Background memory sync is on." : "Background memory sync is off.";
    case "agent_depth":
      return waiting("Only the main session can run memory sync.");
    case "bootstrap_state":
      return waiting("Finishing session setup before sync.");
    case "remember_tool":
      return passed ? "Note storage is available." : "Memory sync needs the remember tool.";
    case "session_signals":
      return waiting("Waiting for a turn with enough activity.");
    case "min_hours":
      return waiting("Waiting until enough time has passed since the last sync.");
    case "scan_interval":
      return waiting("Waiting for the next scheduled sync window.");
    case "min_sessions":
      return waiting("Waiting for enough recent sessions to consolidate.");
    case "lock":
      return passed ? "Sync lock acquired." : "Another sync may already be running.";
    default:
      return passed ? "Check passed." : reason ? `Waiting (${reason}).` : "Waiting for conditions.";
  }
}

function progressTitle(step: string | undefined): { title: string; subtitle?: string; stepIndex?: number } {
  switch (step) {
    case "started":
      return { title: "Gathering recent sessions…", subtitle: "Reading session traces to consolidate.", stepIndex: 0 };
    case "snippets_loaded":
      return { title: "Loading session snippets…", stepIndex: 1 };
    case "model_parsed":
      return { title: "Planning note updates…", subtitle: "Model proposed memory changes.", stepIndex: 2 };
    case "upserts_applied":
      return { title: "Saving merged notes…", stepIndex: 3 };
    case "deletes_applied":
      return { title: "Applying cleanup…", stepIndex: 4 };
    default:
      return { title: "Updating saved notes…", subtitle: undefined, stepIndex: undefined };
  }
}

function mapError(err: string): string {
  if (err === "model_json_unavailable") return "Could not parse the consolidation response. Try again later.";
  if (err.length > 140) return `${err.slice(0, 137)}…`;
  return err;
}

export function buildAutoDreamTechnical(state: AutoDreamState): string {
  const lines: string[] = [`stage: ${state.stage}`];
  if (state.runId) lines.push(`runId: ${state.runId}`);
  if (state.gate) {
    lines.push(
      `gate: ${state.gate.name} passed=${state.gate.passed}` +
        (state.gate.reason ? ` reason=${state.gate.reason}` : "") +
        (state.gate.value !== undefined ? ` value=${String(state.gate.value)}` : "")
    );
  }
  if (state.progress) {
    lines.push(`progress: ${JSON.stringify(state.progress)}`);
  }
  if (state.result) {
    lines.push(`result: ${JSON.stringify(state.result)}`);
  }
  if (state.error) {
    lines.push(`error: ${state.error}`);
  }
  return lines.join("\n");
}

export interface PresentAutoDreamOptions {
  verbosity?: "normal" | "quiet";
}

export function presentAutoDream(
  state: AutoDreamState,
  opts: PresentAutoDreamOptions = {}
): PresentedAutoDream {
  const quiet = opts.verbosity === "quiet";
  const technical = buildAutoDreamTechnical(state);

  // Feature disabled (first gate fails)
  if (state.stage === "gate" && state.gate?.name === "enabled" && !state.gate.passed) {
    const title = "Background memory sync is off.";
    const pill = quiet ? "Sync off" : "Memory sync off (enable in settings)";
    return {
      status: "off",
      title,
      subtitle: "Turn on with AGENT_AUTO_DREAM=1 to merge session notes in the background.",
      technical,
      pillHeadline: pill,
    };
  }

  if (state.stage === "idle") {
    return {
      status: "idle",
      title: "Ready",
      subtitle: "Runs in the background when enough time and sessions have passed.",
      technical,
      pillHeadline: quiet ? "Sync idle" : "Memory sync idle",
    };
  }

  if (state.stage === "failed") {
    const msg = mapError(state.error ?? "Unknown error");
    return {
      status: "failed",
      title: "Memory sync could not finish",
      subtitle: msg,
      technical,
      pillHeadline: quiet ? "Sync failed" : `Sync failed: ${msg.slice(0, 36)}${msg.length > 36 ? "…" : ""}`,
    };
  }

  if (state.stage === "completed") {
    const res = state.result;
    const upserts = res?.upserts ?? 0;
    const deletes = res?.deletes ?? 0;
    const summaryRaw = res?.summary?.trim() ?? "";
    const parts: string[] = [];
    if (upserts > 0) parts.push(`${upserts} update${upserts === 1 ? "" : "s"}`);
    if (deletes > 0) parts.push(`${deletes} removal${deletes === 1 ? "" : "s"}`);
    const title = parts.length > 0 ? `Saved ${parts.join(", ")} to memory.` : "Memory sync finished.";
    const subtitle =
      summaryRaw.length > 0
        ? summaryRaw.slice(0, 200) + (summaryRaw.length > 200 ? "…" : "")
        : undefined;
    return {
      status: "done",
      title,
      subtitle,
      technical,
      pillHeadline: quiet ? "Sync done" : title.slice(0, 48) + (title.length > 48 ? "…" : ""),
    };
  }

  if (state.stage === "gate" && state.gate) {
    const line = gateUserLine(state.gate.name, state.gate.passed, state.gate.reason);
    return {
      status: state.gate.passed ? "running" : "idle",
      title: state.gate.passed ? "Preparing memory sync…" : line,
      subtitle: state.gate.passed ? line : undefined,
      progressIndeterminate: true,
      technical,
      pillHeadline: quiet ? "Sync…" : (state.gate.passed ? "Preparing sync…" : line.slice(0, 44) + (line.length > 44 ? "…" : "")),
    };
  }

  if (state.stage === "started" || state.stage === "progress") {
    const { title, subtitle, stepIndex } = progressTitle(state.progress?.step);
    return {
      status: "running",
      title,
      subtitle: subtitle ?? (typeof state.progress?.sessionsFound === "number"
        ? `${state.progress.sessionsFound} session file(s) in this run.`
        : undefined),
      progressStepIndex: stepIndex,
      progressIndeterminate: stepIndex === undefined,
      technical,
      pillHeadline: quiet ? "Syncing…" : title.slice(0, 46) + (title.length > 46 ? "…" : ""),
    };
  }

  return {
    status: "idle",
    title: "Memory sync",
    technical,
    pillHeadline: quiet ? "Sync" : "Memory sync",
  };
}
