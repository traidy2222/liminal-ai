import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import type { ShellContract, ToolCallEntry, ToolCallGroup, ToolResult, ToolSurface } from "../ShellContract.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { toPng } from "html-to-image";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { migratePersonaUiTheme } from "@liminal/core/persona-ui-theme";
import { categoryForTool } from "../categoryMeta.js";
import { useStickyAutoScroll } from "../../useStickyAutoScroll.js";
import { ShellControls } from "./ShellControls.js";
import {
  buildInputAreaStyle,
  buildUserMessageStyle,
  buildAssistantMessageStyle,
  messageEntranceClass,
  buildAvatarStripeStyle,
  buildAvatarGlyphStyle,
  buildMessagesStyle,
  buildShellBodyStyle,
  orbHidden,
} from "../shellLayout.js";
import { LIM } from "../personaVars.js";
import { StreamingWritePreviewBox } from "../../StreamingWritePreviewBox.js";
import {
  extractStreamingWritePreview,
  isStreamingWriteTool,
} from "@liminal/core/streaming-write-preview";
import { MEMORY_SYNC_LABEL, presentAutoDream } from "../../autoDreamPresent.js";
import type { MessageEntry, PersonalityPulseRow } from "../../useSSE.js";

// ── Palette ───────────────────────────────────────────────────────────────────

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warn, #ffb347)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const GREEN = "var(--lim-success, #00ff88)";
const RED_ERR = "var(--lim-danger, #ff2244)";

// ── Animations ────────────────────────────────────────────────────────────────

const CSS_ANIMATIONS = `
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes data-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hud-in     { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(var(--lim-accent-rgb),.15) transparent}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(var(--lim-accent-rgb),.18);border-radius:2px}
`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function formatSessionTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function parsePrimaryArg(argsJson: string): string {
  if (!argsJson) return "";
  try {
    const a = JSON.parse(argsJson) as Record<string, unknown>;
    for (const k of ["command", "path", "file_path", "query", "url", "key", "goal", "topic", "pid", "task_id", "ticker", "symbol", "name"]) {
      const v = a[k];
      if (typeof v === "string" && v) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 70 ? flat.slice(0, 69) + "…" : flat}`;
      }
      if (typeof v === "number") return `${k}: ${v}`;
    }
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "string" && v.length > 0 && v.length < 120) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 70 ? flat.slice(0, 69) + "…" : flat}`;
      }
    }
  } catch { /* ignore */ }
  return "";
}

function tryFormatOutput(text: string): { formatted: string; wasJson: boolean } {
  const t = text.trim();
  if ((t.startsWith("{") || t.startsWith("[")) && t.length < 8000) {
    try {
      const parsed = JSON.parse(t) as unknown;
      return { formatted: JSON.stringify(parsed, null, 2), wasJson: true };
    } catch { /* not valid JSON */ }
  }
  return { formatted: text, wasJson: false };
}

// ── Rich media helpers ────────────────────────────────────────────────────────

type VideoEmbed = { platform: "youtube" | "vimeo"; id: string };

function detectVideoEmbed(url: string): VideoEmbed | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { platform: "youtube", id: yt[1]! };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { platform: "vimeo", id: vm[1]! };
  return null;
}

function VideoEmbedBlock({ embed }: { embed: VideoEmbed }) {
  const src =
    embed.platform === "youtube"
      ? `https://www.youtube.com/embed/${embed.id}?rel=0`
      : `https://player.vimeo.com/video/${embed.id}`;
  return (
    <div style={{ margin: "14px 0", borderRadius: 8, overflow: "hidden", background: "#010305", position: "relative", paddingBottom: "56.25%" }}>
      <iframe
        src={src}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}

const ALERT_TYPES: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  NOTE:      { icon: "ℹ", color: "#44aaff", bg: "#010c1a", label: "Note"      },
  TIP:       { icon: "💡", color: GREEN,    bg: "#010d05", label: "Tip"       },
  WARNING:   { icon: "⚠", color: AMBER,    bg: "#0e0900", label: "Warning"   },
  IMPORTANT: { icon: "◆", color: "#cc88ff", bg: "#090212", label: "Important" },
  CAUTION:   { icon: "🔥", color: RED_ERR, bg: "#0e0104", label: "Caution"   },
};

function AlertCallout({ type, children }: { type: string; children: React.ReactNode }) {
  const meta = ALERT_TYPES[type] ?? ALERT_TYPES["NOTE"]!;
  return (
    <div style={{
      margin: "14px 0", padding: "12px 16px",
      background: meta.bg,
      border: `1px solid ${meta.color}44`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 5,
    }}>
      <div style={{ color: meta.color, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", marginBottom: 5 }}>
        {meta.icon} {meta.label.toUpperCase()}
      </div>
      <div style={{ color: "#ccd", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

// ── Elapsed timer hook ────────────────────────────────────────────────────────

function useElapsedMs(startedAt: number, active: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return Date.now() - startedAt;
}

// ── STATUS_META ───────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { icon: string; label: string; color: string }> = {
  streaming:        { icon: "…", label: "forming",         color: AMBER   },
  pending_approval: { icon: "⚠", label: "approval needed", color: MAGENTA },
  running:          { icon: "⟳", label: "running",         color: CYAN    },
  done:             { icon: "✓", label: "done",            color: GREEN   },
  error:            { icon: "✗", label: "failed",          color: RED_ERR },
};

// ── HUD Panel ─────────────────────────────────────────────────────────────────

function HudPanel({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: "relative",
      background: "rgba(1,6,16,0.96)",
      border: "1px solid rgba(var(--lim-accent-rgb),0.12)",
      borderRadius: 3,
      boxShadow: "0 0 20px rgba(var(--lim-accent-rgb),0.03), inset 0 0 30px rgba(0,0,0,0.4)",
      animation: "hud-in 0.2s ease",
      ...style,
    }}>
      <span style={{ position: "absolute", top: -1, left: -1, width: 9, height: 9, borderTop: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}` }} />
      <span style={{ position: "absolute", top: -1, right: -1, width: 9, height: 9, borderTop: `2px solid ${CYAN}`, borderRight: `2px solid ${CYAN}` }} />
      <span style={{ position: "absolute", bottom: -1, left: -1, width: 9, height: 9, borderBottom: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}` }} />
      <span style={{ position: "absolute", bottom: -1, right: -1, width: 9, height: 9, borderBottom: `2px solid ${CYAN}`, borderRight: `2px solid ${CYAN}` }} />
      {title && (
        <div style={{
          padding: "4px 10px 3px",
          borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: "rgba(var(--lim-accent-rgb),0.4)",
          fontFamily: "monospace",
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Status orb ────────────────────────────────────────────────────────────────

type OrbState = "idle" | "thinking" | "running" | "approval" | "error" | "disconnected" | "degraded" | "pulse";

function StatusOrb({ orbState, hidden }: { orbState: OrbState; hidden?: boolean }) {
  if (hidden) return null;
  if (orbState === "running") {
    return (
      <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(var(--lim-accent-rgb),0.1)" }} />
        <div
          className="orb-spin-anim"
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: CYAN,
            borderRightColor: "rgba(var(--lim-accent-rgb),0.3)",
          }} />
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 10, height: 10, borderRadius: "50%",
          background: CYAN,
          boxShadow: `0 0 12px ${CYAN}, 0 0 24px rgba(var(--lim-accent-rgb),.4)`,
        }} />
      </div>
    );
  }

  const cfgs: Record<OrbState, { border: string; bg: string; dot: string; animClass: string }> = {
    idle:         { border: `2px solid rgba(var(--lim-accent-rgb),.38)`,   bg: "transparent",                           dot: CYAN,    animClass: "orb-idle-anim"   },
    thinking:     { border: `2px solid ${AMBER}`,                           bg: `rgba(var(--lim-warn-rgb),.07)`,          dot: AMBER,   animClass: "orb-think-anim"  },
    running:      { border: `2px solid ${CYAN}`,                            bg: `rgba(var(--lim-accent-rgb),.06)`,        dot: CYAN,    animClass: "orb-spin-anim"   },
    approval:     { border: `2px solid ${MAGENTA}`,                         bg: `rgba(var(--lim-secondary-rgb),.09)`,     dot: MAGENTA, animClass: "orb-approv-anim" },
    error:        { border: `2px solid ${RED_ERR}`,                         bg: `rgba(var(--lim-danger-rgb),.09)`,        dot: RED_ERR, animClass: ""                },
    disconnected: { border: "2px solid rgba(80,80,90,.35)",                 bg: "transparent",                           dot: LIM.muted, animClass: ""              },
    degraded:     { border: `2px dashed ${AMBER}`,                          bg: `rgba(var(--lim-warn-rgb),.06)`,          dot: AMBER,   animClass: ""                },
    pulse:        { border: `2px solid rgba(var(--lim-secondary-rgb),.45)`, bg: `rgba(var(--lim-secondary-rgb),.07)`,    dot: MAGENTA, animClass: ""                },
  };
  const cfg = cfgs[orbState];

  return (
    <div
      className={cfg.animClass || undefined}
      style={{
        width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
        background: cfg.bg, border: cfg.border,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: cfg.dot,
        boxShadow: `0 0 8px ${cfg.dot}, 0 0 18px ${cfg.dot}66`,
      }} />
    </div>
  );
}

// ── Context arc ───────────────────────────────────────────────────────────────

function ContextArc({ pct, masked }: { pct: number; masked?: boolean }) {
  const r = 27;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? RED_ERR : pct >= 60 ? AMBER : CYAN;
  return (
    <svg width="70" height="70" viewBox="0 0 70 70">
      <circle cx="35" cy="35" r={r} fill="none" stroke="rgba(var(--lim-accent-rgb),0.07)" strokeWidth="4" />
      <circle
        cx="35" cy="35" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90, 35, 35)"
        style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: "stroke-dasharray 0.5s ease" }}
      />
      <text x="35" y="31" textAnchor="middle" fill={color} fontSize="13" fontWeight="700" fontFamily="monospace">{pct}%</text>
      <text x="35" y="44" textAnchor="middle" fill="rgba(var(--lim-accent-rgb),0.32)" fontSize="7" fontFamily="monospace" letterSpacing="2">{masked ? "COMP" : "CTX"}</text>
    </svg>
  );
}

// ── Systems panel ─────────────────────────────────────────────────────────────

type SubtaskEntry = Extract<MessageEntry, { kind: "subtask" }>;

function MissionPanel({ world }: { world: ShellContract["taskWorld"] }) {
  if (!world) return null;
  const criteria = world.verification.successCriteria ?? [];
  const done = criteria.filter((c) => c.status === "satisfied" || c.status === "waived").length;
  const blockers = world.blackboard.filter((b) => b.kind === "blocker").slice(-3);
  const latestEvidence = world.evidence.slice(-4).reverse();
  return (
    <HudPanel title="MISSION">
      <div style={{ padding: "7px 9px 9px", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.35)", fontFamily: "monospace", letterSpacing: "0.1em" }}>
            {world.phase.toUpperCase()}
          </span>
          <span style={{ fontSize: 9, color: CYAN, fontFamily: "monospace", fontWeight: 700 }}>
            {criteria.length > 0 ? `${done}/${criteria.length}` : world.verification.status.toUpperCase()}
          </span>
        </div>
        <div title={world.objective} style={{ fontSize: 10, lineHeight: 1.35, color: "rgba(var(--lim-text-rgb),0.86)", maxHeight: 42, overflow: "hidden" }}>
          {world.objective}
        </div>
        {criteria.slice(0, 4).map((c) => {
          const ok = c.status === "satisfied" || c.status === "waived";
          const color = ok ? GREEN : c.status === "missing" ? RED_ERR : AMBER;
          return (
            <div key={c.id} style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
              <span style={{ color, fontSize: 10, lineHeight: 1 }}>{ok ? "✓" : "•"}</span>
              <span style={{ fontSize: 8, color: "rgba(var(--lim-secondary-rgb),0.66)", lineHeight: 1.35 }}>
                {c.text.length > 56 ? `${c.text.slice(0, 55)}...` : c.text}
              </span>
            </div>
          );
        })}
        {blockers.length > 0 && <div style={{ fontSize: 8, color: RED_ERR, lineHeight: 1.35 }}>{blockers.map((b) => b.summary).join(" · ")}</div>}
        {latestEvidence.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.34)", fontFamily: "monospace" }}>EVIDENCE</div>
            {latestEvidence.map((e) => (
              <div key={e.id} title={e.excerpt} style={{ fontSize: 8, color: "rgba(var(--lim-secondary-rgb),0.58)", lineHeight: 1.3 }}>
                {e.sourceKind}:{e.sourceRef.slice(0, 26)} · {e.claim.slice(0, 52)}
              </div>
            ))}
          </div>
        )}
      </div>
    </HudPanel>
  );
}

function SystemsPanel({
  orbHidden: hideOrbPanel,
  orbState, pct, masked, signalLabel, signalColor, signalDetail, sessionSeconds,
  toolCount, msgCount, subtasks, personaName, autoDream, uiVerbosity, taskWorld,
}: {
  orbHidden?: boolean;
  orbState: OrbState;
  pct: number;
  masked?: boolean;
  signalLabel: string;
  signalColor: string;
  signalDetail: string;
  sessionSeconds: number;
  toolCount: number;
  msgCount: number;
  subtasks: SubtaskEntry[];
  personaName: string;
  autoDream: ShellContract["autoDream"];
  uiVerbosity: "normal" | "quiet";
  taskWorld: ShellContract["taskWorld"];
}) {
  const memorySync = useMemo(
    () => presentAutoDream(autoDream, { verbosity: uiVerbosity }),
    [autoDream, uiVerbosity]
  );
  const syncDotColor = (i: number): string => {
    const idx = memorySync.progressStepIndex;
    if (idx === undefined) return "rgba(var(--lim-accent-rgb),0.15)";
    return i <= idx ? CYAN : "rgba(var(--lim-accent-rgb),0.12)";
  };
  const orbLabel: Record<OrbState, string> = {
    idle: "STANDBY", thinking: "PROCESSING", running: "EXECUTING",
    approval: "AWAITING AUTH", error: "FAULT", disconnected: "OFFLINE",
    degraded: "DEGRADED", pulse: "PULSE",
  };
  const orbColor: Record<OrbState, string> = {
    idle: CYAN, thinking: AMBER, running: CYAN, approval: MAGENTA,
    error: RED_ERR, disconnected: "#556", degraded: AMBER, pulse: MAGENTA,
  };
  const maxDepth = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.depth)) : 0;

  return (
    <div
      data-persona-side-panel
      style={{
        width: 218,
        display: "flex", flexDirection: "column", gap: 7,
        padding: "8px 8px 8px 9px",
        overflowY: "auto", flexShrink: 0,
        borderRight: "1px solid rgba(var(--lim-accent-rgb),0.055)",
      }}>
      <HudPanel title="CORE STATUS">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "12px 8px 10px" }}>
          <StatusOrb orbState={orbState} hidden={hideOrbPanel} />
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: orbColor[orbState], fontFamily: "monospace", textShadow: `0 0 10px ${orbColor[orbState]}55` }}>
            {orbLabel[orbState]}
          </div>
          {personaName !== "Liminal" && (
            <div style={{ fontSize: 9, color: "rgba(var(--lim-secondary-rgb),0.6)", fontFamily: "monospace", letterSpacing: "0.08em" }}>
              [{personaName}]
            </div>
          )}
        </div>
      </HudPanel>

      {pct > 0 && (
        <HudPanel title="CONTEXT BUDGET">
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 4px 6px" }}>
            <ContextArc pct={pct} masked={masked} />
          </div>
        </HudPanel>
      )}

      <HudPanel title="SESSION METRICS">
        <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          {([
            ["UPTIME", formatSessionTime(sessionSeconds)],
            ["TURNS", String(msgCount)],
            ["TOOL OPS", String(toolCount)],
            ["DEPTH", String(maxDepth)],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.35)", fontFamily: "monospace", letterSpacing: "0.1em" }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: CYAN, textShadow: "0 0 6px rgba(var(--lim-accent-rgb),0.27)" }}>{value}</span>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.35)", fontFamily: "monospace", letterSpacing: "0.1em" }}>SIGNAL</span>
              <span
                title={signalDetail || signalLabel}
                style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: signalColor, textAlign: "right", lineHeight: 1.35, textShadow: `0 0 6px ${signalColor}55`, maxWidth: 140 }}
              >
                {signalLabel}
              </span>
            </div>
            {signalDetail.length > 0 && (
              <div style={{ fontSize: 7, lineHeight: 1.4, color: "rgba(var(--lim-secondary-rgb),0.55)", fontFamily: "monospace", textAlign: "right", opacity: 0.92 }} title={signalDetail}>
                {signalDetail}
              </div>
            )}
          </div>
        </div>
      </HudPanel>

      <MissionPanel world={taskWorld} />

      {subtasks.length > 0 && (
        <HudPanel title="AGENT NETWORK">
          <div style={{ padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: CYAN, boxShadow: `0 0 7px ${CYAN}` }} />
              <span style={{ fontSize: 9, color: CYAN, fontFamily: "monospace", letterSpacing: "0.06em" }}>ROOT</span>
            </div>
            {subtasks.slice(0, 10).map((s) => {
              const sc = s.status === "running" ? CYAN : s.status === "done" ? GREEN : s.status === "error" ? RED_ERR : "#445";
              return (
                <div key={s.taskId} style={{ display: "flex", alignItems: "flex-start", gap: 3, paddingLeft: Math.max(4, s.depth * 12) }}>
                  <span style={{ color: "rgba(var(--lim-accent-rgb),0.18)", fontSize: 9, fontFamily: "monospace", marginTop: 1, flexShrink: 0 }}>└─</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: sc, boxShadow: s.status === "running" ? `0 0 6px ${sc}` : "none", animation: s.status === "running" ? "data-pulse 1.1s ease-in-out infinite" : "none" }} />
                    <span style={{ fontSize: 8, fontFamily: "monospace", color: sc, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 128 }}>
                      {s.goal.length > 24 ? s.goal.slice(0, 23) + "…" : s.goal}
                    </span>
                  </div>
                </div>
              );
            })}
            {subtasks.length > 10 && (
              <div style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.25)", fontFamily: "monospace", paddingLeft: 14 }}>
                +{subtasks.length - 10} more
              </div>
            )}
          </div>
        </HudPanel>
      )}

      <HudPanel title={MEMORY_SYNC_LABEL}>
        <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, lineHeight: 1.35,
            color: memorySync.status === "failed" ? RED_ERR : memorySync.status === "done" ? GREEN : memorySync.status === "off" ? "#667788" : "#99aabb",
          }}>
            {memorySync.title}
          </div>
          {memorySync.subtitle && uiVerbosity !== "quiet" && (
            <div style={{ fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.45)", lineHeight: 1.4 }}>{memorySync.subtitle}</div>
          )}
          {(memorySync.status === "running" || memorySync.progressIndeterminate) && memorySync.status !== "off" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {memorySync.progressStepIndex !== undefined ? (
                <div style={{ display: "flex", gap: 4, alignItems: "center", paddingTop: 2 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: syncDotColor(i), boxShadow: i <= (memorySync.progressStepIndex ?? -1) ? "0 0 6px rgba(var(--lim-accent-rgb),0.45)" : "none" }} />
                  ))}
                </div>
              ) : (
                <div style={{ height: 3, borderRadius: 2, background: "rgba(var(--lim-accent-rgb),0.2)", opacity: 0.85, animation: "data-pulse 1.2s ease-in-out infinite" }} />
              )}
            </div>
          )}
          {memorySync.status === "done" && autoDream.result != null && (
            <div style={{ fontSize: 9, color: "rgba(var(--lim-success-rgb),0.45)" }}>
              Completed in {formatElapsed(autoDream.result.durationMs)}
            </div>
          )}
          {uiVerbosity !== "quiet" && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.35)", cursor: "pointer", userSelect: "none" }}>Technical details</summary>
              <pre style={{ marginTop: 6, fontSize: 9, color: "#445566", background: "rgba(0,4,10,0.85)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", borderRadius: 3, padding: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflowY: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                {memorySync.technical}
              </pre>
            </details>
          )}
        </div>
      </HudPanel>
    </div>
  );
}

// ── Activity stream ────────────────────────────────────────────────────────────

const ActivityStream = memo(function ActivityStream({
  toolCalls,
  toolResultMap,
  pulseActive,
  pulseRows,
}: {
  toolCalls: ToolCallEntry[];
  toolResultMap: Map<string, ToolResult>;
  pulseActive: boolean;
  pulseRows: PersonalityPulseRow[];
}) {
  const hasRunning = toolCalls.some((t) => t.status === "running" || t.status === "streaming") || pulseActive;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  const MAX_BAR_MS = 20000;
  const recent = [...toolCalls].reverse().slice(0, 40);
  const pulseRecent = [...pulseRows].reverse().slice(0, 14);

  return (
    <div style={{ width: 252, display: "flex", flexDirection: "column", flexShrink: 0, borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.055)" }}>
      <div style={{ padding: "7px 10px 6px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(var(--lim-accent-rgb),0.38)", fontFamily: "monospace" }}>ACTIVITY STREAM</span>
        {hasRunning && (
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: CYAN, boxShadow: "0 0 6px rgba(var(--lim-accent-rgb),0.55)", animation: "data-pulse 0.75s ease-in-out infinite" }} />
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "3px 0" }}>
        {pulseActive && (
          <div style={{ padding: "4px 10px 6px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                <span style={{ color: MAGENTA, fontSize: 9, flexShrink: 0 }}>◇</span>
                <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 600, color: "#aabbcc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>Pulse · idle tick</span>
              </div>
              <span style={{ color: CYAN, fontSize: 9 }}>⟳</span>
            </div>
          </div>
        )}
        {pulseRecent.map((row, idx) => {
          if (row.phase === "skipped") {
            return (
              <div key={`${row.id}-${idx}`} style={{ padding: "4px 10px 5px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "#556677", fontSize: 9 }}>◇</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#556677", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>skipped · {row.reason}</span>
                </div>
                {row.detail && <div style={{ fontSize: 8, color: "#445566", marginTop: 2, whiteSpace: "pre-wrap" }}>{row.detail.slice(0, 120)}</div>}
              </div>
            );
          }
          const elapsed = row.durationMs;
          return (
            <div key={row.runId} style={{ padding: "4px 10px 5px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                  <span style={{ color: MAGENTA, fontSize: 9, flexShrink: 0 }}>◇</span>
                  <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 600, color: "#667788", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{row.summary}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <span style={{ color: GREEN, fontSize: 9 }}>✓</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#334455" }}>{formatElapsed(elapsed)}</span>
                </div>
              </div>
              {row.reflectionsPreview && row.reflectionsPreview.length > 0 && (
                <div style={{ marginTop: 3, fontSize: 8, color: "#445566", lineHeight: 1.35 }}>
                  {row.reflectionsPreview[0]!.slice(0, 140)}{row.reflectionsPreview[0]!.length > 140 ? "…" : ""}
                </div>
              )}
            </div>
          );
        })}
        {recent.length === 0 && pulseRecent.length === 0 && !pulseActive && (
          <div style={{ padding: "28px 12px", textAlign: "center", color: "rgba(var(--lim-accent-rgb),0.18)", fontSize: 10, fontFamily: "monospace" }}>awaiting activity…</div>
        )}
        {recent.map((tc) => {
          const cat   = categoryForTool(tc.name);
          const sm    = STATUS_META[tc.status] ?? STATUS_META["done"]!;
          const result = toolResultMap.get(tc.callId);
          const isActive = tc.status === "running" || tc.status === "streaming";
          const elapsed = tc.endedAt !== undefined ? tc.endedAt - tc.startedAt : Date.now() - tc.startedAt;
          const barPct = Math.min(100, (elapsed / MAX_BAR_MS) * 100);
          return (
            <div key={tc.callId} style={{ padding: "4px 10px 5px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                  <span style={{ color: cat.color, fontSize: 9, flexShrink: 0 }}>{cat.icon}</span>
                  <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 600, color: isActive ? "#aabbcc" : "#445566", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 118 }}>{tc.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <span style={{ color: sm.color, fontSize: 9 }}>{sm.icon}</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#334455" }}>{formatElapsed(elapsed)}</span>
                </div>
              </div>
              <div style={{ marginTop: 3, height: 2, borderRadius: 1, background: "rgba(var(--lim-accent-rgb),0.05)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${barPct}%`, borderRadius: 1,
                  background: result?.ok === false
                    ? "linear-gradient(90deg, rgba(var(--lim-danger-rgb),0.6), rgba(var(--lim-danger-rgb),0.25))"
                    : isActive ? `linear-gradient(90deg,${cat.color}cc,${cat.color}44)` : `linear-gradient(90deg,${cat.color}55,${cat.color}22)`,
                  transition: isActive ? "none" : "width 0.3s ease",
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── ToolCard ──────────────────────────────────────────────────────────────────

const PREVIEW_LINES = 10;

import type { PersonaUiToolCards } from "@liminal/core/persona-ui-theme";
import { resolveToolCardsMode } from "../../resolveToolCardsMode.js";

function ToolCard({ entry, result, toolCardsMode }: { entry: ToolCallEntry; result?: ToolResult; toolCardsMode?: PersonaUiToolCards }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = entry.status === "streaming" || entry.status === "running" || entry.status === "pending_approval";
  const elapsedMs = useElapsedMs(entry.startedAt, isActive);
  const displayMs = isActive ? elapsedMs : entry.endedAt !== undefined ? entry.endedAt - entry.startedAt : null;
  const cat = categoryForTool(entry.name);
  const sm  = STATUS_META[entry.status] ?? STATUS_META["done"]!;
  const arg = parsePrimaryArg(entry.argsJson);
  const showWritePreview = isStreamingWriteTool(entry.name) && isActive;
  const writePreview = showWritePreview ? extractStreamingWritePreview(entry.name, entry.argsJson ?? "") : null;
  const mode = toolCardsMode ?? "verbose";

  if (mode === "hidden") return null;

  if (mode === "log") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, fontFamily: "monospace", padding: "2px 0", color: "#445566" }}>
        <span style={{ color: cat.color }}>{cat.icon}</span>
        <span style={{ color: sm.color }}>{sm.icon}</span>
        <span style={{ color: "#778899" }}>{entry.name}</span>
        {arg && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{arg}</span>}
        {displayMs !== null && <span style={{ color: "#334455", marginLeft: "auto" }}>{formatElapsed(displayMs)}</span>}
      </div>
    );
  }

  const isCompact = mode === "compact";
  const rawOutput = result ? result.output.trimEnd() : "";
  const { formatted: formattedOutput } = result ? tryFormatOutput(rawOutput) : { formatted: "" };
  const outputLines = formattedOutput ? formattedOutput.split("\n") : [];
  const previewCap = isCompact ? 3 : PREVIEW_LINES;
  const previewText = outputLines.slice(0, previewCap).map(l => l.length > 200 ? l.slice(0, 199) + "…" : l).join("\n");
  const extraLines = Math.max(0, outputLines.length - previewCap);
  const fullText = outputLines.map(l => l.length > 200 ? l.slice(0, 199) + "…" : l).join("\n");

  return (
    <div style={{ borderRadius: 3, padding: "6px 10px", background: "rgba(0,6,16,0.8)", border: "1px solid rgba(var(--lim-accent-rgb),0.07)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11, borderLeftColor: sm.color, borderLeftWidth: 2, borderLeftStyle: "solid" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
          <span style={{ color: cat.color, fontSize: 13, flexShrink: 0 }}>{cat.icon}</span>
          <span style={{ color: "#ccddee", fontWeight: 700, flexShrink: 0, fontSize: 12 }}>{entry.name}</span>
          {arg && <span style={{ color: "#445566", fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{arg}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          {displayMs !== null && <span style={{ color: "#334455", fontSize: 10 }}>{formatElapsed(displayMs)}</span>}
          <span style={{ color: sm.color, fontSize: 10, fontWeight: 700, background: `${sm.color}14`, border: `1px solid ${sm.color}38`, borderRadius: 3, padding: "1px 6px", letterSpacing: "0.02em" }}>
            {sm.icon}{" "}
            {entry.status === "running" && writePreview && !writePreview.incomplete
              ? "writing to disk…"
              : entry.status === "streaming" && writePreview && writePreview.charCount > 0
              ? `streaming ${writePreview.charCount.toLocaleString()} chars`
              : entry.status === "streaming" && writePreview?.incomplete
              ? "streaming args"
              : sm.label}
          </span>
        </div>
      </div>
      {showWritePreview && (
        <StreamingWritePreviewBox toolName={entry.name} argsJson={entry.argsJson ?? ""} isActive={isActive} elapsedMs={elapsedMs} compact={isCompact} />
      )}
      {isActive && !result && !showWritePreview && (
        <div style={{ marginTop: 5 }}>
          <span style={{ color: "#223344", fontSize: 10, fontStyle: "italic" }}>
            {entry.status === "running" && writePreview && !writePreview.incomplete
              ? "writing to disk…"
              : entry.status === "streaming"
              ? "streaming arguments…"
              : entry.status === "pending_approval"
              ? "awaiting approval…"
              : "executing…"}
          </span>
        </div>
      )}
      {result && result.output.trim() && (
        <div style={{ marginTop: 6 }}>
          <pre style={{ margin: 0, padding: "5px 9px", background: "rgba(0,4,10,0.8)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", borderRadius: 3, fontSize: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.5, maxHeight: isCompact ? 120 : 260, overflowY: "auto", color: result.ok ? "#556677" : "#ff7766" }}>
            {expanded ? fullText : previewText}
          </pre>
          {extraLines > 0 && (
            <button type="button" onClick={() => setExpanded(v => !v)} style={{ marginTop: 3, background: "none", border: "none", color: "#334455", fontSize: 10, cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}>
              {expanded ? "▲ collapse" : `▼ ${extraLines} more line${extraLines !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ToolGroupCard ─────────────────────────────────────────────────────────────

function ToolGroupCard({ group, toolResultMap, surface, toolCardsMode }: { group: ToolCallGroup; toolResultMap: Map<string, ToolResult>; surface: ToolSurface; toolCardsMode?: PersonaUiToolCards }) {
  const cat = categoryForTool(group.name);
  const doneCount    = group.entries.filter(e => e.status === "done").length;
  const errorCount   = group.entries.filter(e => e.status === "error").length;
  const runningCount = group.entries.filter(e => e.status === "running" || e.status === "streaming").length;
  const allDone      = doneCount + errorCount === group.entries.length;
  const [open, setOpen] = useState(allDone);
  useEffect(() => { if (allDone) setOpen(true); }, [allDone]);
  const statusColor  = errorCount > 0 ? RED_ERR : allDone ? GREEN : CYAN;
  const statusIcon   = errorCount > 0 ? "✗" : allDone ? "✓" : "⟳";

  return (
    <div style={{ borderRadius: 3, padding: "6px 10px", background: "rgba(0,6,16,0.8)", border: "1px solid rgba(var(--lim-accent-rgb),0.07)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11, borderLeftColor: statusColor, borderLeftWidth: 2, borderLeftStyle: "solid" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen(v => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: cat.color, fontSize: 13 }}>{cat.icon}</span>
          <span style={{ color: "#ccddee", fontWeight: 700, fontSize: 12 }}>{group.name}</span>
          <span style={{ color: "#334455", fontSize: 10 }}>× {group.entries.length} parallel</span>
          {runningCount > 0 && <span style={{ color: CYAN, fontSize: 10 }}>{runningCount} running</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: statusColor, fontSize: 10, fontWeight: 700, background: `${statusColor}14`, border: `1px solid ${statusColor}38`, borderRadius: 3, padding: "1px 6px" }}>
            {statusIcon} {doneCount}/{group.entries.length} done{errorCount > 0 ? ` · ${errorCount} failed` : ""}
          </span>
          <span style={{ color: "#334455", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
          {group.entries.map(entry => (
            <ToolCard key={entry.callId} entry={entry} result={toolResultMap.get(entry.callId)} toolCardsMode={toolCardsMode} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── SubtaskView ───────────────────────────────────────────────────────────────

function SubtaskView({ entry, surface }: { entry: SubtaskEntry; surface: ToolSurface }) {
  const [showStream, setShowStream] = useState(surface === "verbose");
  useEffect(() => { setShowStream(surface === "verbose"); }, [surface]);
  const statusColor = entry.status === "running" ? CYAN : entry.status === "done" ? GREEN : entry.status === "error" ? RED_ERR : "#556677";
  const statusIcon  = entry.status === "running" ? "⟳" : entry.status === "done" ? "✓" : entry.status === "error" ? "✗" : "⊘";
  const outputLines = entry.status === "running" && entry.partialOutput
    ? entry.partialOutput.trimEnd().split("\n").filter(l => l.trim()).slice(-4)
    : [];
  const showLines = surface === "verbose" || showStream;

  return (
    <div style={{ padding: "5px 11px", background: "rgba(0,5,14,0.7)", borderRadius: 3, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", borderLeft: `2px solid ${statusColor}`, color: "#889aaa", marginLeft: entry.depth * 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: MAGENTA }}>{"⤷".repeat(Math.max(1, entry.depth))}</span>
        <span style={{ color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
        <span style={{ color: "#334455", fontSize: 10, fontFamily: "monospace" }}>{entry.taskId.slice(0, 8)}</span>
        <span style={{ color: "#99aabb" }}>{entry.goal.length > 120 ? entry.goal.slice(0, 119) + "…" : entry.goal}</span>
      </div>
      {outputLines.length > 0 && showLines && (
        <div style={{ marginTop: 4, paddingLeft: 20 }}>
          {outputLines.map((line, i) => (
            <div key={i} style={{ color: "#334455", fontSize: 10, fontFamily: "monospace", lineHeight: 1.4 }}>
              {line.length > 160 ? line.slice(0, 159) + "…" : line}
            </div>
          ))}
        </div>
      )}
      {surface === "clean" && outputLines.length > 0 && !showStream && (
        <button type="button" onClick={() => setShowStream(true)} style={{ marginTop: 4, marginLeft: 20, background: "none", border: "none", color: "#445566", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
          Show sub-agent stream
        </button>
      )}
    </div>
  );
}

// ── ModelReasoningBlock ───────────────────────────────────────────────────────

function ModelReasoningBlock({ entry, surface }: { entry: Extract<MessageEntry, { kind: "model_reasoning" }>; surface: ToolSurface }) {
  const [open, setOpen] = useState(surface === "verbose");
  useEffect(() => {
    if (surface === "verbose") setOpen(true);
    else if (!entry.streaming) setOpen(false);
  }, [surface, entry.streaming]);
  const label = entry.streaming
    ? `Model reasoning · ${entry.text.length.toLocaleString()} chars · live`
    : `Model reasoning · ${entry.text.length.toLocaleString()} chars`;

  if (surface === "clean" && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ display: "block", width: "100%", textAlign: "left", background: "rgba(0,4,12,0.55)", border: "1px solid rgba(var(--lim-warn-rgb),0.12)", borderRadius: 4, color: "#556677", fontSize: 11, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ color: "#665533", fontWeight: 700 }}>◈ {label}</span>
        <span style={{ color: "#445566", marginLeft: 8 }}>— expand</span>
      </button>
    );
  }
  const body = entry.text.length > 2400 && !entry.streaming ? entry.text.slice(0, 2400) + "…" : entry.text;
  return (
    <div style={{ padding: "7px 11px", background: "rgba(0,4,12,0.6)", border: "1px solid rgba(var(--lim-warn-rgb),0.2)", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.18)", borderRadius: 3, lineHeight: 1.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#665533", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>◈ MODEL REASONING{entry.streaming ? " · LIVE" : ""}</div>
        {surface === "clean" && (
          <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#445566", fontSize: 10, cursor: "pointer" }}>Collapse</button>
        )}
      </div>
      <div style={{ color: "#6a5a44", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 12 }}>
        {body}
        {entry.streaming && <span style={{ color: "#aa8844", marginLeft: 4 }} aria-hidden>▍</span>}
      </div>
    </div>
  );
}

// ── ThinkBlock ────────────────────────────────────────────────────────────────

function ThinkBlock({ entry, surface }: { entry: Extract<MessageEntry, { kind: "think" }>; surface: ToolSurface }) {
  const [thinkOpen, setThinkOpen] = useState(surface === "verbose" || Boolean(entry.streaming));
  useEffect(() => {
    if (entry.streaming) setThinkOpen(true);
    else setThinkOpen(surface === "verbose");
  }, [surface, entry.streaming]);
  const charLabel = entry.content.length.toLocaleString();

  if (surface === "clean" && !thinkOpen && !entry.streaming) {
    return (
      <button type="button" onClick={() => setThinkOpen(true)} style={{ display: "block", width: "100%", textAlign: "left", background: "rgba(0,4,12,0.55)", border: "1px solid rgba(var(--lim-accent-rgb),0.08)", borderRadius: 4, color: "#556677", fontSize: 11, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ color: "#334455", fontWeight: 700 }}>◈ Reasoning</span>
        <span style={{ color: "#445566", marginLeft: 8 }}>({charLabel} chars) — expand</span>
      </button>
    );
  }
  const hasStructured = (entry.tool_families && entry.tool_families.length > 0) || entry.scope || (entry.unknowns && entry.unknowns.length > 0) || entry.clarification_needed || entry.self_check !== undefined;

  return (
    <div style={{ padding: "7px 11px", background: "rgba(0,4,12,0.6)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.18)", borderRadius: 3, lineHeight: 1.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#334455", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>◈ REASONING{entry.streaming ? " · LIVE" : ""}</div>
        {surface === "clean" && (
          <button type="button" onClick={() => setThinkOpen(false)} style={{ background: "none", border: "none", color: "#445566", fontSize: 10, cursor: "pointer" }}>Collapse</button>
        )}
      </div>
      <div style={{ color: "#556677", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 12 }}>
        {entry.streaming
          ? entry.content.length > 4000 ? "…" + entry.content.slice(-4000) : entry.content
          : entry.content.length > 1200 ? entry.content.slice(0, 1200) + "…" : entry.content}
        {entry.streaming && <span style={{ color: "#6688aa", marginLeft: 4 }} aria-hidden>▍</span>}
      </div>
      {hasStructured && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(var(--lim-accent-rgb),0.07)", display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 10 }}>
          {entry.scope && <span style={{ color: "#445566" }}>scope: <span style={{ color: "#556677" }}>{entry.scope}</span></span>}
          {entry.tool_families && entry.tool_families.length > 0 && <span style={{ color: "#445566" }}>families: <span style={{ color: "#556677" }}>{entry.tool_families.join(", ")}</span></span>}
          {entry.unknowns && entry.unknowns.length > 0 && <span style={{ color: "#445566" }}>unknowns: <span style={{ color: "#556677" }}>{entry.unknowns.join(" · ")}</span></span>}
          {entry.self_check !== undefined && <span style={{ color: entry.self_check >= 80 ? "#33aa66" : "#aa7733" }}>self-check: {entry.self_check}/100</span>}
          {entry.clarification_needed && entry.clarification_question && <span style={{ color: "#ddaa44", fontWeight: 600, width: "100%" }}>❓ {entry.clarification_question}</span>}
        </div>
      )}
    </div>
  );
}

function ReasonBlock({ entry }: { entry: Extract<MessageEntry, { kind: "reason" }> }) {
  const confidenceColor =
    entry.confidence === "low" ? "#887755" : entry.confidence === "high" ? "#55aa77" : "#556677";
  return (
    <div style={{ padding: "5px 10px", background: "rgba(0,4,12,0.45)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.10)", borderRadius: 3, lineHeight: 1.5 }}>
      <span style={{ color: "#334455", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginRight: 8 }}>→ INFERENCE{entry.streaming ? " · LIVE" : ""}</span>
      <span style={{ color: "#4a5c6a", fontStyle: "italic", fontSize: 12 }}>
        {entry.inference}
        {entry.streaming && <span style={{ color: "#6688aa", marginLeft: 4 }} aria-hidden>▍</span>}
      </span>
      {(entry.confidence || entry.next_action) && (
        <span style={{ marginLeft: 10, fontSize: 10, color: confidenceColor }}>
          {entry.confidence && <span>[{entry.confidence}]</span>}
          {entry.next_action && <span style={{ marginLeft: 6, color: "#445566" }}>→ {entry.next_action}</span>}
        </span>
      )}
    </div>
  );
}

// ── MessageView ───────────────────────────────────────────────────────────────

function MessageView({
  entry,
  toolResult,
  surface,
  personaTheme,
  toolCardsMode,
}: {
  entry: MessageEntry;
  toolResult?: ToolResult;
  surface: ToolSurface;
  personaTheme: ReturnType<typeof migratePersonaUiTheme>;
  toolCardsMode: PersonaUiToolCards;
}) {
  const entrance = messageEntranceClass(personaTheme.messageEntrance);
  const entranceProp = entrance ? { className: entrance } : {};

  switch (entry.kind) {
    case "user":
      return (
        <div {...entranceProp} style={{ padding: "8px 12px", background: LIM.userBg, borderRadius: "var(--lim-radius, 6px)", borderLeft: `2px solid ${CYAN}`, lineHeight: 1.5, boxShadow: "inset 0 0 20px rgba(var(--lim-accent-rgb),0.02)", ...buildUserMessageStyle(personaTheme) }}>
          <span style={{ color: CYAN, fontWeight: 700 }}>You </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
        </div>
      );

    case "assistant": {
      const avatarStyle = personaTheme.avatarStyle;
      const showGlyph = avatarStyle === "glyph";
      const stripeExtra = avatarStyle === "stripe" ? buildAvatarStripeStyle() : {};
      return (
        <div {...entranceProp} style={{ padding: "5px 0", color: LIM.assistant, lineHeight: 1.65, ...buildAssistantMessageStyle(), ...stripeExtra, ...(showGlyph ? { display: "flex", alignItems: "flex-start" } : {}) }}>
          {showGlyph && <span style={buildAvatarGlyphStyle(avatarStyle)}>{personaTheme.avatarGlyph ?? "❯"}</span>}
          <div className="lim-md" style={showGlyph ? { flex: 1, minWidth: 0 } : undefined}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                p({ node, children }) {
                  const kids = node?.children ?? [];
                  if (kids.length === 1 && kids[0]?.type === "element" && (kids[0] as { tagName?: string }).tagName === "a") {
                    const href = (kids[0] as { properties?: { href?: string } }).properties?.href ?? "";
                    const embed = detectVideoEmbed(href);
                    if (embed) return <VideoEmbedBlock embed={embed} />;
                  }
                  if (kids.length === 1 && kids[0]?.type === "text") {
                    const rawText = (kids[0] as { value?: string }).value ?? "";
                    const embed = detectVideoEmbed(rawText.trim());
                    if (embed) return <VideoEmbedBlock embed={embed} />;
                  }
                  return <p style={{ margin: "0 0 10px", whiteSpace: "normal", lineHeight: 1.72 }}>{children}</p>;
                },
                img({ src, alt, title }) {
                  if (!src) return null;
                  const embed = detectVideoEmbed(src);
                  if (embed) return <VideoEmbedBlock embed={embed} />;
                  return (
                    <span style={{ display: "block", margin: "12px 0" }}>
                      <img src={src} alt={alt ?? ""} title={title ?? ""} loading="lazy" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", display: "block" }} />
                      {alt && <span style={{ display: "block", textAlign: "center", color: LIM.textDim, fontSize: 11, marginTop: 4, fontStyle: "italic" }}>{alt}</span>}
                    </span>
                  );
                },
                a({ href, children }) {
                  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, textDecoration: "none", borderBottom: "1px dotted rgba(var(--lim-accent-rgb),0.3)" }}>{children}</a>;
                },
                h1({ children }) { return <h1 style={{ fontSize: 22, margin: "18px 0 10px", color: LIM.markdownH1, borderBottom: "1px solid rgba(var(--lim-success-rgb),0.15)", paddingBottom: 5, fontWeight: 700 }}>{children}</h1>; },
                h2({ children }) { return <h2 style={{ fontSize: 18, margin: "16px 0 8px", color: LIM.markdownH2, fontWeight: 700 }}>{children}</h2>; },
                h3({ children }) { return <h3 style={{ fontSize: 15, margin: "12px 0 6px", color: LIM.secondary, fontWeight: 600 }}>{children}</h3>; },
                h4({ children }) { return <h4 style={{ fontSize: 13, margin: "10px 0 4px", color: AMBER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{children}</h4>; },
                ul({ children }) { return <ul style={{ margin: "0 0 10px 22px", lineHeight: 1.72 }}>{children}</ul>; },
                ol({ children }) { return <ol style={{ margin: "0 0 10px 22px", lineHeight: 1.72 }}>{children}</ol>; },
                li({ children }) { return <li style={{ margin: "3px 0" }}>{children}</li>; },
                pre({ children }) { return <div style={{ margin: "10px 0" }}>{children}</div>; },
                code({ className, children }) {
                  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
                  const raw  = String(children).replace(/\n$/, "");
                  if (lang) {
                    return (
                      <div style={{ borderRadius: 6, overflow: "hidden", margin: "10px 0", border: "1px solid rgba(var(--lim-accent-rgb),0.1)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", background: LIM.surface, borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.08)" }}>
                          <span style={{ color: "rgba(var(--lim-accent-rgb),0.4)", fontSize: 10, fontFamily: "monospace", letterSpacing: "0.06em" }}>{lang}</span>
                        </div>
                        <SyntaxHighlighter language={lang} style={vscDarkPlus} customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: LIM.codeBg }} showLineNumbers={raw.split("\n").length > 6} lineNumberStyle={{ color: LIM.textDim, minWidth: "2.5em", opacity: 0.45 }} wrapLongLines>
                          {raw}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }
                  return <code style={{ background: LIM.surface1, border: "1px solid rgba(var(--lim-accent-rgb),0.12)", borderRadius: 3, padding: "1px 5px", color: GREEN, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.9em" }}>{children}</code>;
                },
                blockquote({ node, children }) {
                  const firstPara = (node?.children ?? []).find(c => (c as { type?: string }).type === "element" && (c as { tagName?: string }).tagName === "p");
                  const firstText = firstPara
                    ? ((firstPara as { children?: Array<{ type?: string; value?: string }> }).children ?? []).find(c => c.type === "text")?.value ?? ""
                    : "";
                  const alertMatch = firstText.trimStart().match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i);
                  if (alertMatch) {
                    const type = alertMatch[1]!.toUpperCase();
                    const stripped = React.Children.map(children, (child, ci) => {
                      if (ci !== 0) return child;
                      if (React.isValidElement(child)) {
                        const el = child as React.ReactElement<{ children?: React.ReactNode }>;
                        const grandkids = React.Children.map(el.props.children, (gc, gi) => {
                          if (gi !== 0) return gc;
                          if (typeof gc === "string") return gc.replace(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i, "");
                          return gc;
                        });
                        return React.cloneElement(el, {}, ...(grandkids ?? []));
                      }
                      return child;
                    });
                    return <AlertCallout type={type}>{stripped}</AlertCallout>;
                  }
                  return <blockquote style={{ margin: "12px 0", padding: "8px 14px", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.25)", color: LIM.textDim, fontStyle: "italic", background: LIM.surface1, borderRadius: "0 4px 4px 0" }}>{children}</blockquote>;
                },
                table({ children }) { return <div style={{ overflowX: "auto", margin: "12px 0", borderRadius: 5, overflow: "hidden" }}><table style={{ width: "100%", borderCollapse: "collapse", background: LIM.surface1 }}>{children}</table></div>; },
                th({ children }) { return <th style={{ textAlign: "left", border: "1px solid rgba(var(--lim-accent-rgb),0.1)", padding: "7px 12px", background: LIM.surface2, color: LIM.textMuted, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em" }}>{children}</th>; },
                td({ children }) { return <td style={{ border: "1px solid rgba(var(--lim-accent-rgb),0.07)", padding: "6px 12px", verticalAlign: "top", color: LIM.textDim }}>{children}</td>; },
                hr() { return <div style={{ margin: "18px 0", height: 1, background: "linear-gradient(90deg, transparent, rgba(var(--lim-accent-rgb),0.15), rgba(var(--lim-success-rgb),0.33), rgba(var(--lim-accent-rgb),0.15), transparent)" }} />; },
              }}
            >
              {entry.text}
            </ReactMarkdown>
            {entry.streaming && <span style={{ color: CYAN, animation: "blink 1s step-end infinite" }}>█</span>}
          </div>
        </div>
      );
    }

    case "trace":
      return (
        <div style={{ paddingLeft: 8, borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.07)", lineHeight: 1.4, opacity: 0.65 }}>
          <span style={{ color: "#223344", fontSize: 9, fontWeight: 700, marginRight: 6 }}>[trace]</span>
          <span style={{ whiteSpace: "pre-wrap", color: "#334455", fontSize: 10 }}>{entry.text}</span>
        </div>
      );

    case "pulse_nudge":
      return (
        <div style={{ margin: "8px 0 4px", padding: "9px 12px", borderRadius: 6, background: "rgba(28, 38, 52, 0.75)", border: "1px solid rgba(var(--lim-accent-rgb),0.08)" }}>
          <span style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: "0.14em", color: "rgba(var(--lim-accent-rgb),0.35)" }}>PULSE · </span>
          <span style={{ fontSize: 12, color: "#aab8c8", whiteSpace: "pre-wrap" }}>{entry.text}</span>
        </div>
      );

    case "provider_retry":
      return (
        <div style={{ paddingLeft: 8, borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.07)", lineHeight: 1.4, opacity: 0.65 }}>
          <span style={{ color: "#664422", fontSize: 11 }}>{entry.text}</span>
        </div>
      );

    case "tool_call":
      return <ToolCard entry={entry} result={toolResult} toolCardsMode={toolCardsMode} />;

    case "tool_result":
      return null;

    case "model_reasoning":
      return <ModelReasoningBlock entry={entry} surface={surface} />;

    case "think":
      return <ThinkBlock entry={entry} surface={surface} />;

    case "reason":
      return <ReasonBlock entry={entry} />;

    case "plan": {
      const steps = Array.isArray(entry.steps) ? entry.steps : [];
      if (steps.length === 0 && entry.streaming && entry.previewText) {
        return (
          <div style={{ padding: "9px 14px", background: "rgba(0,8,20,0.7)", border: "1px solid rgba(var(--lim-accent-rgb),0.1)", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.35)", borderRadius: 3 }}>
            <div style={{ color: CYAN, fontWeight: 700, marginBottom: 8, fontSize: 12, letterSpacing: "0.06em" }}>▸ PLAN · LIVE</div>
            <pre style={{ margin: 0, fontSize: 11, color: "#667788", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{entry.previewText.slice(-1200)}</pre>
          </div>
        );
      }
      if (steps.length === 0) return null;
      return (
        <div style={{ padding: "9px 14px", background: "rgba(0,8,20,0.7)", border: "1px solid rgba(var(--lim-accent-rgb),0.1)", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.35)", borderRadius: 3 }}>
          <div style={{ color: CYAN, fontWeight: 700, marginBottom: 8, fontSize: 12, letterSpacing: "0.06em" }}>▸ PLAN</div>
          {steps.map((step, i) => {
            const done = step.startsWith("✓");
            const text = done ? step.slice(2) : step;
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", color: done ? GREEN : "#667788", fontSize: 12, lineHeight: 1.6, paddingLeft: 4 }}>
                <span style={{ flexShrink: 0, color: done ? GREEN : "#334455" }}>{done ? "✓" : "○"}</span>
                <span style={{ textDecoration: done ? "line-through" : "none", opacity: done ? 0.6 : 1 }}>{i + 1}. {text}</span>
              </div>
            );
          })}
        </div>
      );
    }

    case "subtask":
      return <SubtaskView entry={entry} surface={surface} />;

    case "context_compressed":
      return (
        <div style={{ padding: "4px 10px", color: "#334455", fontSize: 10, fontStyle: "italic", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.15)", fontFamily: "monospace" }}>
          ⊙ Context compressed: {entry.beforePct}% → {entry.afterPct}%
          {entry.rounds > 0 && ` (${entry.rounds} round${entry.rounds !== 1 ? "s" : ""} summarised)`}
        </div>
      );

    default:
      return null;
  }
}

// ── HudShell ──────────────────────────────────────────────────────────────────

/** JARVIS grid HUD — side panels + ring orb (default). */
export function HudShell({ contract }: { contract: ShellContract }) {
  const messagesRef  = useRef<HTMLDivElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const [screenshotting, setScreenshotting] = useState(false);

  const personaTheme = useMemo(() => migratePersonaUiTheme(contract.personaTheme), [contract.personaTheme]);
  const hideOrb = orbHidden(personaTheme.shell, personaTheme.orbStyle);
  const shell = personaTheme.shell;

  useStickyAutoScroll(messagesRef, bottomRef, contract.groupedMessages);

  // Textarea auto-height
  const syncTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(40, Math.min(el.scrollHeight, 180))}px`;
  }, []);

  useEffect(() => { syncTextareaHeight(); }, [contract.input, syncTextareaHeight]);

  // Screenshot
  const handleScreenshot = useCallback(async () => {
    const el = messagesRef.current;
    if (!el || screenshotting) return;
    setScreenshotting(true);
    try {
      const fullHeight = el.scrollHeight;
      const width = el.offsetWidth;
      const savedOverflowY = el.style.overflowY;
      const savedHeight    = el.style.height;
      const savedMaxHeight = el.style.maxHeight;
      const savedFlex      = el.style.flex;
      el.style.overflowY = "visible";
      el.style.height    = `${fullHeight}px`;
      el.style.maxHeight = "none";
      el.style.flex      = "none";
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#020408", width, height: fullHeight });
      el.style.overflowY = savedOverflowY;
      el.style.height    = savedHeight;
      el.style.maxHeight = savedMaxHeight;
      el.style.flex      = savedFlex;
      const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1);
      const link = document.createElement("a");
      link.download = `liminal-${ts}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Screenshot failed:", err);
    } finally {
      setScreenshotting(false);
    }
  }, [screenshotting]);

  const { showPanels, groupedMessages, toolResultMap, surface, showRawHarness, rawHarnessBlob,
    error, input, attachments, attachError, isDragOver, canSend, busy, totalAttachmentKb,
    onInputChange, onSubmit, onKeyDown, onPaste, onDragOver, onDragLeave, onDrop, onRemoveAttachment,
    orbState, signalHud, pct, contextSnapshot, sessionSeconds, toolCount, msgCount, toolErrorCount,
    subtasks, allToolCalls, autoDream, taskWorld, uiVerbosity, pulseChips, lastTurnProviderRetries,
    lastContextCompress, heartbeatEnabled, heartbeatUiStrip, personalityPulseActive,
    personalityPulseRows, dreamLabel, activeToolCall,
    personaDisplayLabel, personaName,
  } = contract;

  const visibleMessages = groupedMessages;
  const toolCardsMode = resolveToolCardsMode(personaTheme.toolCards, surface);

  return (
    <>
      <style>{CSS_ANIMATIONS}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 14px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)", background: "rgba(2,4,8,0.98)", flexShrink: 0, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: CYAN, fontWeight: 800, fontSize: 12, letterSpacing: "0.28em", fontFamily: "monospace" }}>{personaDisplayLabel}</span>
          {signalHud.label !== "ONLINE" && (
            <span title={signalHud.detail || signalHud.label} style={{ color: signalHud.color, fontSize: 9, fontFamily: "monospace", letterSpacing: "0.06em", opacity: signalHud.label === "WAIT API" ? 0.85 : 1 }}>
              ● {signalHud.label}
            </span>
          )}
          {activeToolCall && !showPanels && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(var(--lim-accent-rgb),0.06)", border: "1px solid rgba(var(--lim-accent-rgb),0.15)", borderRadius: 20, padding: "2px 10px", fontSize: 10 }}>
              <span style={{ color: categoryForTool(activeToolCall.name).color }}>{categoryForTool(activeToolCall.name).icon}</span>
              <span style={{ color: "#889aaa", fontSize: 10, fontFamily: "monospace" }}>{activeToolCall.name}</span>
              {activeToolCall.status === "pending_approval" && <span style={{ color: MAGENTA, fontSize: 10, fontWeight: 700 }}>— approve?</span>}
            </div>
          )}
          {!showPanels && autoDream.stage !== "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(var(--lim-accent-rgb),0.06)", border: "1px solid rgba(var(--lim-accent-rgb),0.15)", borderRadius: 20, padding: "2px 10px", fontSize: 10 }}>
              <span style={{ color: autoDream.stage === "failed" ? RED_ERR : autoDream.stage === "completed" ? GREEN : CYAN }}>◈</span>
              <span style={{ color: "#889aaa", fontSize: 10, fontFamily: "monospace" }}>{dreamLabel}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!showPanels && contextSnapshot && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, width: 120 }}>
              <div style={{ flex: 1, height: 2, background: "rgba(var(--lim-accent-rgb),0.08)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct >= 80 ? RED_ERR : pct >= 60 ? AMBER : CYAN, borderRadius: 1, transition: "width 0.4s" }} />
              </div>
              <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.35)", fontSize: 9, fontFamily: "monospace" }}>{pct}%</span>
            </div>
          )}
          <ShellControls contract={contract} tone="mono" />
          <button type="button" style={{ background: "transparent", border: "1px solid rgba(var(--lim-accent-rgb),0.18)", borderRadius: 2, color: "rgba(var(--lim-accent-rgb),0.45)", padding: "3px 10px", fontSize: 9, cursor: "pointer", fontFamily: "monospace", letterSpacing: "0.1em", opacity: screenshotting ? 0.5 : 1 }} disabled={screenshotting || visibleMessages.length === 0} onClick={() => void handleScreenshot()} title="Capture session">
            {screenshotting ? "…" : "CAPTURE"}
          </button>
        </div>
      </div>

      {/* 3-column body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, ...buildShellBodyStyle(shell) }}>
        {showPanels && (
          <SystemsPanel
            orbHidden={hideOrb}
            orbState={orbState as OrbState}
            pct={pct}
            masked={contextSnapshot?.masked}
            signalLabel={signalHud.label}
            signalColor={signalHud.color}
            signalDetail={signalHud.detail}
            sessionSeconds={sessionSeconds}
            toolCount={toolCount}
            msgCount={msgCount}
            subtasks={subtasks as SubtaskEntry[]}
            personaName={personaName}
            autoDream={autoDream}
            taskWorld={taskWorld}
            uiVerbosity={uiVerbosity}
          />
        )}

        {/* Center */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div ref={messagesRef} style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 7, ...buildMessagesStyle(personaTheme) }}>
            {visibleMessages.length === 0 && !busy && (
              <div style={{ color: "rgba(var(--lim-accent-rgb),0.12)", textAlign: "center", marginTop: 80, fontSize: 13, fontFamily: "monospace", letterSpacing: "0.1em" }}>AWAITING INPUT</div>
            )}
            {groupedMessages.map((entry, i) => {
              if ("kind" in entry && entry.kind === "tool_group") {
                return (
                  <ToolGroupCard
                    key={`grp-${i}-${entry.name}`}
                    group={entry as ToolCallGroup}
                    toolResultMap={toolResultMap}
                    surface={surface}
                    toolCardsMode={toolCardsMode}
                  />
                );
              }
              const m = entry as MessageEntry;
              return (
                <MessageView
                  key={i}
                  entry={m}
                  toolResult={m.kind === "tool_call" ? toolResultMap.get(m.callId) : undefined}
                  surface={surface}
                  personaTheme={personaTheme}
                  toolCardsMode={toolCardsMode}
                />
              );
            })}
            {error && <div style={{ color: RED_ERR, padding: "8px 0", fontSize: 12, fontFamily: "monospace" }}>✗ {error}</div>}
            {!showRawHarness && rawHarnessBlob.trim().length > 0 && (
              <details style={{ marginTop: 10, borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)", paddingTop: 8 }}>
                <summary style={{ color: "#556677", fontSize: 11, cursor: "pointer", userSelect: "none" }}>Full harness trace ({rawHarnessBlob.length.toLocaleString()} chars) — optional</summary>
                <pre style={{ marginTop: 8, maxHeight: 220, overflow: "auto", fontSize: 10, color: "#445566", background: "rgba(0,4,12,0.75)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", borderRadius: 4, padding: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{rawHarnessBlob}</pre>
              </details>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Footer strip */}
          <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "6px 18px 8px", fontSize: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", borderTop: "1px solid rgba(var(--lim-accent-rgb),0.06)", color: "#556677", background: "rgba(1,3,8,0.96)" }}>
            <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.45)" }}>CTX {pct}%</span>
            {lastTurnProviderRetries > 0 && <span style={{ color: AMBER }}>{lastTurnProviderRetries} provider retr{lastTurnProviderRetries === 1 ? "y" : "ies"} (recovered)</span>}
            {toolErrorCount > 0 && <span style={{ color: RED_ERR }}>{toolErrorCount} tool error{toolErrorCount === 1 ? "" : "s"}</span>}
            {lastContextCompress && <span style={{ color: "#556677" }}>Compressed {lastContextCompress.beforePct}% → {lastContextCompress.afterPct}%</span>}
            <span style={{ color: "#334455", marginLeft: "auto" }}>{surface === "clean" ? "Clean view — toggle RAW for full harness lines" : "Verbose view"}</span>
          </div>

          {/* Pulse strip */}
          {heartbeatEnabled && heartbeatUiStrip && (personalityPulseActive || pulseChips.length > 0) && (
            <div style={{ padding: "5px 12px 6px", borderTop: "1px solid rgba(var(--lim-accent-rgb),0.05)", background: "rgba(0,6,14,0.35)", fontFamily: "monospace", fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.35)", letterSpacing: "0.06em" }}>
              <span style={{ color: MAGENTA }}>PULSE</span>
              {personalityPulseActive && <span style={{ marginLeft: 8, color: "#8899aa" }}>syncing…</span>}
              {pulseChips.map((c) => (
                <span key={c.runId} title={c.summary} style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 3, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", color: "#778899", maxWidth: 160, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "middle" }}>
                  {c.summary.slice(0, 48)}{c.summary.length > 48 ? "…" : ""}
                </span>
              ))}
            </div>
          )}

          {/* Input form */}
          <form
            style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 14px", background: "rgba(2,4,8,0.98)", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: isDragOver ? CYAN : "rgba(var(--lim-accent-rgb),0.07)", outline: isDragOver ? `1px dashed rgba(var(--lim-accent-rgb),0.4)` : "none", flexShrink: 0 }}
            onSubmit={onSubmit}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {attachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {attachments.map((attachment, idx) => (
                  <div key={`${attachment.name}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(0,8,18,0.85)", border: "1px solid rgba(var(--lim-accent-rgb),0.14)", borderRadius: 3, padding: "3px 7px" }}>
                    <img src={attachment.dataUrl} alt={attachment.name} style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 2 }} />
                    <span style={{ fontSize: 10, color: "#667788", fontFamily: "monospace" }}>{attachment.name} ({Math.round(attachment.sizeBytes / 1024)} KB)</span>
                    <button type="button" style={{ background: "none", border: "none", color: "#445566", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }} onClick={() => onRemoveAttachment(idx)} disabled={busy}>×</button>
                  </div>
                ))}
                <span style={{ fontSize: 10, color: "#445566", fontFamily: "monospace" }}>{attachments.length} image{attachments.length === 1 ? "" : "s"} ({totalAttachmentKb} KB)</span>
              </div>
            )}
            {attachError && <div style={{ color: RED_ERR, fontSize: 11, fontFamily: "monospace" }}>{attachError}</div>}
            <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
              <textarea
                id="chat-message-input"
                name="message"
                ref={inputRef}
                rows={1}
                style={{ flex: 1, background: "rgba(0,8,18,0.85)", border: "1px solid rgba(var(--lim-accent-rgb),0.14)", borderRadius: 3, color: "#aabbcc", padding: "8px 12px", fontSize: 14, fontFamily: "inherit", outline: "none", resize: "none", minHeight: 40, maxHeight: 180, overflowY: "auto", lineHeight: 1.4, ...buildInputAreaStyle(personaTheme) }}
                value={input}
                onChange={e => { onInputChange(e.target.value); }}
                onKeyDown={e => void onKeyDown(e)}
                onPaste={e => void onPaste(e)}
                placeholder={busy ? "processing…" : "transmit…"}
                disabled={busy}
              />
              <button type="submit" style={{ border: `1px solid ${canSend ? "rgba(var(--lim-accent-rgb),0.4)" : "rgba(var(--lim-accent-rgb),0.08)"}`, borderRadius: 3, color: canSend ? CYAN : "rgba(var(--lim-accent-rgb),0.2)", padding: "8px 16px", cursor: canSend ? "pointer" : "default", background: canSend ? "rgba(0,60,100,0.8)" : "rgba(0,6,14,0.6)", fontFamily: "monospace", letterSpacing: "0.1em", fontSize: 11 }} disabled={!canSend}>SEND</button>
            </div>
            <div style={{ fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.2)", letterSpacing: "0.03em", fontFamily: "monospace" }}>Enter send · Shift+Enter newline · Ctrl/Cmd+K clear · Ctrl/Cmd+Shift+L new session</div>
          </form>
        </div>

        {showPanels && (
          <ActivityStream
            toolCalls={allToolCalls as ToolCallEntry[]}
            toolResultMap={toolResultMap}
            pulseActive={personalityPulseActive}
            pulseRows={personalityPulseRows}
          />
        )}
      </div>
    </>
  );
}
