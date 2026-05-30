import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_PERSONA_UI_THEME } from "@liminal/core/persona-ui-theme";
import { ShellRouter } from "../persona/ShellRouter.js";
import { PersonaShellSwitcher } from "../persona/shells/ShellSwitcher.js";
import type { ShellContract, OrbState, ToolResult } from "../persona/ShellContract.js";
import type { MessageEntry } from "../useSSE.js";
import { applyPersonaDocumentTheme } from "../applyPersonaDocumentTheme.js";
import { groupToolCalls } from "./groupToolCalls.js";
import { getMarketingScenario } from "./scenarios.js";
import { MarketingApprovalOverlay, MarketingPersonaBootstrap } from "./MarketingOverlays.js";

const CSS_ANIMATIONS = `
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes data-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hud-in     { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
`;

type ParseParams =
  | { mode: "illustrative"; scenarioId: string; frame: number }
  | { mode: "recording"; recordingId: string };

function parseParams(): ParseParams {
  const params = new URLSearchParams(window.location.search);
  const recordingId = params.get("recording")?.trim();
  if (recordingId) return { mode: "recording", recordingId };
  const scenarioId = params.get("scenario")?.trim() || "coding-typescript";
  const frame = Math.max(0, parseInt(params.get("frame") ?? "99", 10) || 99);
  return { mode: "illustrative", scenarioId, frame };
}

function buildToolResultMap(messages: MessageEntry[]): Map<string, ToolResult> {
  const m = new Map<string, ToolResult>();
  for (const msg of messages) {
    if (msg.kind === "tool_result") m.set(msg.callId, { output: msg.output, ok: msg.ok });
  }
  return m;
}

interface RecordingPayload {
  prompt?: string;
  messages: MessageEntry[];
  meta?: { tools?: string[]; durationMs?: number };
}

export function MarketingApp() {
  const params = parseParams();
  const [recording, setRecording] = useState<RecordingPayload | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    if (params.mode !== "recording") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/marketing-recordings/${params.recordingId}/messages.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RecordingPayload;
        if (!cancelled) setRecording(data);
      } catch (e) {
        if (!cancelled) {
          setRecordingError(
            e instanceof Error ? e.message : "Failed to load recording (run marketing:capture:live first)"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.mode, params.mode === "recording" ? params.recordingId : ""]);

  const illustrative = params.mode === "illustrative" ? getMarketingScenario(params.scenarioId) : undefined;
  const scenario =
    illustrative ?? getMarketingScenario("coding-typescript")!;

  const theme = scenario.theme ?? DEFAULT_PERSONA_UI_THEME;
  applyPersonaDocumentTheme(theme);

  const messages: MessageEntry[] = useMemo(() => {
    if (params.mode === "recording") {
      return recording?.messages ?? [];
    }
    const frameIndex = Math.min(
      params.frame >= 99 ? scenario.frames.length - 1 : params.frame,
      scenario.frames.length - 1
    );
    return scenario.frames[frameIndex] ?? [];
  }, [params, recording, scenario.frames]);

  const visibleMessages = useMemo(
    () => messages.filter((e) => e.kind !== "trace" && e.kind !== "provider_retry"),
    [messages]
  );
  const groupedMessages = useMemo(() => groupToolCalls(visibleMessages), [visibleMessages]);
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);

  const overlay = params.mode === "illustrative" ? scenario.overlay : "none";
  const contextPct =
    params.mode === "recording" && recording?.meta?.durationMs
      ? Math.min(48, 12 + Math.round((recording.meta.tools?.length ?? 0) * 3))
      : scenario.contextPct ?? 12;

  const orbState: OrbState =
    overlay === "approval"
      ? "approval"
      : scenario.orbState === "running"
        ? "running"
        : scenario.busy
          ? "thinking"
          : "idle";

  if (params.mode === "recording" && !recording && !recordingError) {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", color: "#8899aa" }}>
        Loading live recording…
      </div>
    );
  }

  if (recordingError) {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", color: "#ff6688", padding: 24 }}>
        {recordingError}
      </div>
    );
  }

  const contract: ShellContract = {
    personaTheme: theme,
    personaDisplayLabel: scenario.displayLabel ?? theme.displayLabel,
    personaName: scenario.personaName ?? "Liminal",
    groupedMessages,
    toolResultMap,
    surface: "clean",
    showRawHarness: false,
    rawHarnessBlob: "",
    error: null,
    input: "",
    attachments: [],
    attachError: null,
    isDragOver: false,
    canSend: false,
    totalAttachmentKb: 0,
    busy: scenario.busy ?? false,
    onInputChange: () => {},
    onSubmit: (e) => e.preventDefault(),
    onKeyDown: async () => {},
    onPaste: async () => {},
    onDragOver: () => {},
    onDragLeave: () => {},
    onDrop: async () => {},
    onRemoveAttachment: () => {},
    orbState,
    signalHud: {
      label: "SIGNAL",
      color: "var(--lim-success, #00ff88)",
      detail: params.mode === "recording" ? "live recording replay" : "illustrative fixture",
    },
    pct: contextPct,
    contextSnapshot: { usageFraction: contextPct / 100, masked: false },
    sessionSeconds: 184,
    toolCount: messages.filter((m) => m.kind === "tool_call").length,
    msgCount: messages.filter((m) => m.kind === "user" || m.kind === "assistant").length,
    toolErrorCount: messages.filter((m) => m.kind === "tool_result" && !m.ok).length,
    subtasks: messages.filter((m) => m.kind === "subtask"),
    allToolCalls: messages.filter((m) => m.kind === "tool_call"),
    autoDream: { stage: "idle", updatedAt: Date.now() },
    uiVerbosity: "normal",
    pulseChips: [],
    lastTurnProviderRetries: 0,
    lastContextCompress: null,
    heartbeatEnabled: false,
    heartbeatUiStrip: false,
    personalityPulseActive: false,
    personalityPulseRows: [],
    dreamLabel: "",
    activeToolCall: undefined,
    windowWidth: typeof window !== "undefined" ? window.innerWidth : 1280,
    showPanels: true,
    onClearSession: async () => {},
    onOpenSettings: () => {},
    onToggleRaw: () => {},
    dictationAudioCue: false,
    onDictationAutoSend: () => "Dictation disabled in marketing preview",
  };

  const dataAttrs =
    params.mode === "recording"
      ? { "data-marketing-ready": "true", "data-recording": params.recordingId, "data-source": "live" }
      : {
          "data-marketing-ready": "true",
          "data-scenario": scenario.id,
          "data-frame": String(params.mode === "illustrative" ? params.frame : 0),
          "data-source": "illustrative",
        };

  return (
    <ShellRouter theme={theme}>
      <style>{CSS_ANIMATIONS}</style>
      <div {...dataAttrs} style={{ height: "100vh" }}>
        <PersonaShellSwitcher shell={theme.shell} contract={contract} />
        {overlay === "approval" && <MarketingApprovalOverlay />}
        {overlay === "persona-bootstrap" && <MarketingPersonaBootstrap />}
      </div>
    </ShellRouter>
  );
}
