import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useSSE, type MessageEntry, type AutoDreamState, type PersonalityPulseRow, WEB_SERVER_BASE } from "./useSSE.js";
import { MEMORY_SYNC_LABEL, presentAutoDream } from "./autoDreamPresent.js";
import { applyPersonaDocumentTheme } from "./applyPersonaDocumentTheme.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { toPng } from "html-to-image";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { SettingsModal } from "./settings/SettingsModal.js";
import { resolveInputShortcut } from "./inputSemantics.js";
import {
  PERSONA_QUICK_PRESETS,
  personaBootstrapStageHint,
} from "@liminal/core/persona-bootstrap-ui";
import type { HarnessSettingsApiField } from "@liminal/core";
import {
  DEFAULT_IMAGE_ATTACHMENT_LIMITS,
  normalizeImageAttachmentName,
  parseDataUrlImage,
  validateImageAttachments,
  type ImageAttachment,
} from "./imageAttachments.js";

// ── HUD palette (CSS variables; defaults from applyPersonaDocumentTheme + fallbacks) ──

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warn, #ffb347)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const GREEN = "var(--lim-success, #00ff88)";
const RED_ERR = "var(--lim-danger, #ff2244)";
const BG = "var(--lim-bg, #020408)";

// ── CSS animations (injected via <style> tag) ─────────────────────────────────

const CSS_ANIMATIONS = `
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes data-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hud-in     { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(var(--lim-accent-rgb),.15) transparent}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(var(--lim-accent-rgb),.18);border-radius:2px}
`;

// ── Type aliases (defined early — used by new panel components) ───────────────

type ToolCallEntry = Extract<MessageEntry, { kind: "tool_call" }>;
type SubtaskEntry  = Extract<MessageEntry, { kind: "subtask" }>;

// ── Tool category helpers ─────────────────────────────────────────────────────

type ToolCategory =
  | "shell" | "file" | "web" | "memory" | "vault" | "code"
  | "git" | "markets" | "vision" | "docs" | "orchestration" | "context" | "other";

function getToolCategory(name: string): ToolCategory {
  if (/^(run_shell|run_background|kill_process|list_processes|read_process_output)$/.test(name)) return "shell";
  if (/^(read_file|write_file|list_dir|apply_diff|patch_file|edit_file|write_file_if_changed|search_replace_file|batch_replace|grep_file|move_file|copy_file|copy_tree|mkdir_p|edit_preview|multi_file_apply|refactor_plan_apply|path_guard|read_file_chunked|read_file_with_imports|file_metadata|workspace_snapshot)$/.test(name)) return "file";
  if (/^(web_fetch|web_search|weather_lookup)$/.test(name)) return "web";
  if (/^(remember|recall|recall_type|recall_relevant|search_memory|forget|forget_type|memory_stats|memory_consolidate|memory_query|memory_graph)$/.test(name)) return "memory";
  if (name.startsWith("vault_")) return "vault";
  if (/^(ast_grep|symbol_index|find_references|run_tests|run_lint|execute_code|repo_map)$/.test(name)) return "code";
  if (name.startsWith("git_")) return "git";
  if (name.startsWith("markets_")) return "markets";
  if (/^(vision_analyze|upload_image)$/.test(name)) return "vision";
  if (name.startsWith("doc_")) return "docs";
  if (/^(spawn_agent|wait_for_agents|cancel_agent|list_agents|verify_result|evidence_critic|path_critic|policy_critic|reflect_debate)$/.test(name)) return "orchestration";
  if (/^(check_context|compress_context|refresh_world_context)$/.test(name)) return "context";
  return "other";
}

const CATEGORY_META: Record<ToolCategory, { icon: string; color: string }> = {
  shell:         { icon: "▶", color: "#ff5544" },
  file:          { icon: "◇", color: "#44aaff" },
  web:           { icon: "◎", color: "#bb66ff" },
  memory:        { icon: "◈", color: AMBER },
  vault:         { icon: "⊚", color: GREEN },
  code:          { icon: "◆", color: "#55ee99" },
  git:           { icon: "⌥", color: "#ff9944" },
  markets:       { icon: "◉", color: "#ffee44" },
  vision:        { icon: "◑", color: "#ff99cc" },
  docs:          { icon: "▣", color: "#7788ff" },
  orchestration: { icon: "⟴", color: MAGENTA },
  context:       { icon: "⊙", color: CYAN },
  other:         { icon: "⚙", color: "#778899" },
};

const STATUS_META: Record<string, { icon: string; label: string; color: string }> = {
  streaming:        { icon: "…", label: "forming",         color: AMBER   },
  pending_approval: { icon: "⚠", label: "approval needed", color: MAGENTA },
  running:          { icon: "⟳", label: "running",         color: CYAN    },
  done:             { icon: "✓", label: "done",            color: GREEN   },
  error:            { icon: "✗", label: "failed",          color: RED_ERR },
};

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

// ── Approval countdown ────────────────────────────────────────────────────────

function ApprovalCountdown({ receivedAt, approvalTimeoutMs }: { receivedAt: number; approvalTimeoutMs: number }) {
  const deadline = receivedAt + approvalTimeoutMs;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [receivedAt, approvalTimeoutMs]);
  const leftSec = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div style={{ fontSize: 11, color: leftSec <= 10 ? RED_ERR : "#556", fontFamily: "monospace" }}>
      auto-reject in {leftSec}s
    </div>
  );
}

// ── HUD Panel ─────────────────────────────────────────────────────────────────

function HudPanel({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const C = CYAN;
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
      <span style={{ position: "absolute", top: -1, left: -1, width: 9, height: 9, borderTop: `2px solid ${C}`, borderLeft: `2px solid ${C}` }} />
      <span style={{ position: "absolute", top: -1, right: -1, width: 9, height: 9, borderTop: `2px solid ${C}`, borderRight: `2px solid ${C}` }} />
      <span style={{ position: "absolute", bottom: -1, left: -1, width: 9, height: 9, borderBottom: `2px solid ${C}`, borderLeft: `2px solid ${C}` }} />
      <span style={{ position: "absolute", bottom: -1, right: -1, width: 9, height: 9, borderBottom: `2px solid ${C}`, borderRight: `2px solid ${C}` }} />
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

type OrbState = "idle" | "thinking" | "running" | "approval" | "error" | "disconnected" | "pulse";

function StatusOrb({ orbState }: { orbState: OrbState }) {
  if (orbState === "running") {
    return (
      <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(var(--lim-accent-rgb),0.1)" }} />
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "2px solid transparent",
          borderTopColor: CYAN,
          borderRightColor: "rgba(var(--lim-accent-rgb),0.3)",
          animation: "orb-spin 0.65s linear infinite",
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

  const cfgs: Record<OrbState, { border: string; bg: string; dot: string; anim: string }> = {
    idle:         { border: `2px solid rgba(var(--lim-accent-rgb),.38)`,   bg: "transparent",           dot: CYAN,    anim: "orb-idle 3.5s ease-in-out infinite"   },
    thinking:     { border: `2px solid ${AMBER}`,              bg: `rgba(var(--lim-warn-rgb),.07)`,  dot: AMBER,   anim: "orb-think 1.8s ease-in-out infinite"  },
    running:      { border: `2px solid ${CYAN}`,               bg: `rgba(var(--lim-accent-rgb),.06)`,   dot: CYAN,    anim: "orb-spin 0.65s linear infinite"        },
    approval:     { border: `2px solid ${MAGENTA}`,            bg: `rgba(var(--lim-secondary-rgb),.09)`,  dot: MAGENTA, anim: "orb-approv 0.7s ease-in-out infinite" },
    error:        { border: `2px solid ${RED_ERR}`,            bg: `rgba(var(--lim-danger-rgb),.09)`,   dot: RED_ERR, anim: "none"                                  },
    disconnected: { border: "2px solid rgba(80,80,90,.35)",    bg: "transparent",           dot: "#556",  anim: "none"                                  },
    pulse:        { border: `2px solid rgba(var(--lim-secondary-rgb),.45)`, bg: `rgba(var(--lim-secondary-rgb),.07)`, dot: MAGENTA, anim: "data-pulse 1.1s ease-in-out infinite" },
  };
  const cfg = cfgs[orbState];

  return (
    <div style={{
      width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
      background: cfg.bg, border: cfg.border, animation: cfg.anim,
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

// ── Context arc (SVG gauge) ───────────────────────────────────────────────────

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

// ── Systems panel (left column) ───────────────────────────────────────────────

function SystemsPanel({
  orbState, pct, masked, connected, sessionSeconds,
  toolCount, msgCount, subtasks, personaName, autoDream, uiVerbosity,
}: {
  orbState: OrbState; pct: number; masked?: boolean; connected: boolean;
  sessionSeconds: number; toolCount: number; msgCount: number;
  subtasks: SubtaskEntry[]; personaName: string; autoDream: AutoDreamState;
  uiVerbosity: "normal" | "quiet";
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
    pulse: "PULSE",
  };
  const orbColor: Record<OrbState, string> = {
    idle: CYAN, thinking: AMBER, running: CYAN,
    approval: MAGENTA, error: RED_ERR, disconnected: "#556",
    pulse: MAGENTA,
  };
  const maxDepth = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.depth)) : 0;

  return (
    <div style={{
      width: 218,
      display: "flex", flexDirection: "column", gap: 7,
      padding: "8px 8px 8px 9px",
      overflowY: "auto", flexShrink: 0,
      borderRight: "1px solid rgba(var(--lim-accent-rgb),0.055)",
    }}>

      {/* Core status */}
      <HudPanel title="CORE STATUS">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "12px 8px 10px" }}>
          <StatusOrb orbState={orbState} />
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.16em",
            color: orbColor[orbState], fontFamily: "monospace",
            textShadow: `0 0 10px ${orbColor[orbState]}55`,
          }}>
            {orbLabel[orbState]}
          </div>
          {personaName !== "Liminal" && (
            <div style={{ fontSize: 9, color: "rgba(var(--lim-secondary-rgb),0.6)", fontFamily: "monospace", letterSpacing: "0.08em" }}>
              [{personaName}]
            </div>
          )}
        </div>
      </HudPanel>

      {/* Context arc */}
      {pct > 0 && (
        <HudPanel title="CONTEXT BUDGET">
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 4px 6px" }}>
            <ContextArc pct={pct} masked={masked} />
          </div>
        </HudPanel>
      )}

      {/* Session stats */}
      <HudPanel title="SESSION METRICS">
        <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          {([
            ["UPTIME",   formatSessionTime(sessionSeconds)],
            ["TURNS",    String(msgCount)],
            ["TOOL OPS", String(toolCount)],
            ["DEPTH",    String(maxDepth)],
            ["SIGNAL",   connected ? "ONLINE" : "OFFLINE"],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, color: "rgba(var(--lim-accent-rgb),0.35)", fontFamily: "monospace", letterSpacing: "0.1em" }}>
                {label}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                color: label === "SIGNAL"
                  ? (connected ? GREEN : RED_ERR)
                  : CYAN,
                textShadow:
                  label === "SIGNAL"
                    ? connected
                      ? "0 0 6px rgba(var(--lim-success-rgb),0.35)"
                      : "0 0 6px rgba(var(--lim-danger-rgb),0.35)"
                    : "0 0 6px rgba(var(--lim-accent-rgb),0.27)",
              }}>
                {value}
              </span>
        </div>
          ))}
        </div>
      </HudPanel>

      {/* Agent network tree */}
      {subtasks.length > 0 && (
        <HudPanel title="AGENT NETWORK">
          <div style={{ padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
            {/* Root node */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: CYAN, boxShadow: `0 0 7px ${CYAN}` }} />
              <span style={{ fontSize: 9, color: CYAN, fontFamily: "monospace", letterSpacing: "0.06em" }}>ROOT</span>
            </div>
            {subtasks.slice(0, 10).map((s) => {
              const sc = s.status === "running"  ? CYAN
                       : s.status === "done"     ? GREEN
                       : s.status === "error"    ? RED_ERR
                       : "#445";
              return (
                <div key={s.taskId} style={{ display: "flex", alignItems: "flex-start", gap: 3, paddingLeft: Math.max(4, s.depth * 12) }}>
                  <span style={{ color: "rgba(var(--lim-accent-rgb),0.18)", fontSize: 9, fontFamily: "monospace", marginTop: 1, flexShrink: 0 }}>└─</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                      background: sc,
                      boxShadow: s.status === "running" ? `0 0 6px ${sc}` : "none",
                      animation: s.status === "running" ? "data-pulse 1.1s ease-in-out infinite" : "none",
                    }} />
                    <span style={{
                      fontSize: 8, fontFamily: "monospace", color: sc,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      maxWidth: 128,
                    }}>
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
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color:
                memorySync.status === "failed"
                  ? RED_ERR
                  : memorySync.status === "done"
                    ? GREEN
                    : memorySync.status === "off"
                      ? "#667788"
                      : "#99aabb",
              lineHeight: 1.35,
            }}
          >
            {memorySync.title}
          </div>
          {memorySync.subtitle && uiVerbosity !== "quiet" && (
            <div style={{ fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.45)", lineHeight: 1.4 }}>
              {memorySync.subtitle}
            </div>
          )}
          {(memorySync.status === "running" || memorySync.progressIndeterminate) && memorySync.status !== "off" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {memorySync.progressStepIndex !== undefined ? (
                <div style={{ display: "flex", gap: 4, alignItems: "center", paddingTop: 2 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: syncDotColor(i),
                        boxShadow: i <= (memorySync.progressStepIndex ?? -1) ? "0 0 6px rgba(var(--lim-accent-rgb),0.45)" : "none",
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: "rgba(var(--lim-accent-rgb),0.2)",
                    opacity: 0.85,
                    animation: "data-pulse 1.2s ease-in-out infinite",
                  }}
                />
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
              <summary style={{ fontSize: 9, color: "rgba(var(--lim-accent-rgb),0.35)", cursor: "pointer", userSelect: "none" }}>
                Technical details
              </summary>
              <pre
                style={{
                  marginTop: 6,
                  fontSize: 9,
                  color: "#445566",
                  background: "rgba(0,4,10,0.85)",
                  border: "1px solid rgba(var(--lim-accent-rgb),0.06)",
                  borderRadius: 3,
                  padding: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 140,
                  overflowY: "auto",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              >
                {memorySync.technical}
              </pre>
            </details>
          )}
        </div>
      </HudPanel>
    </div>
  );
}

// ── Activity stream (right column) ────────────────────────────────────────────

const ActivityStream = memo(function ActivityStream({
  toolCalls,
  toolResultMap,
  pulseActive,
  pulseRows,
}: {
  toolCalls: ToolCallEntry[];
  toolResultMap: Map<string, { output: string; ok: boolean }>;
  pulseActive: boolean;
  pulseRows: PersonalityPulseRow[];
}) {
  const hasRunning =
    toolCalls.some((t) => t.status === "running" || t.status === "streaming") || pulseActive;
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
    <div style={{
      width: 252,
      display: "flex", flexDirection: "column", flexShrink: 0,
      borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.055)",
    }}>
      {/* Header */}
      <div style={{
        padding: "7px 10px 6px",
        borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(var(--lim-accent-rgb),0.38)", fontFamily: "monospace" }}>
          ACTIVITY STREAM
        </span>
        {hasRunning && (
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: CYAN, boxShadow: "0 0 6px rgba(var(--lim-accent-rgb),0.55)",
            animation: "data-pulse 0.75s ease-in-out infinite",
          }} />
        )}
            </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: "3px 0" }}>
        {pulseActive && (
          <div style={{
            padding: "4px 10px 6px",
            borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.05)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                <span style={{ color: MAGENTA, fontSize: 9, flexShrink: 0 }}>◇</span>
                <span style={{
                  fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                  color: "#aabbcc",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 150,
                }}>
                  Pulse · idle tick
                </span>
              </div>
              <span style={{ color: CYAN, fontSize: 9 }}>⟳</span>
            </div>
          </div>
        )}
        {pulseRecent.map((row, idx) => {
          if (row.phase === "skipped") {
            return (
              <div
                key={`${row.id}-${idx}`}
                style={{
                  padding: "4px 10px 5px",
                  borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "#556677", fontSize: 9 }}>◇</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#556677", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    skipped · {row.reason}
                  </span>
                </div>
                {row.detail && (
                  <div style={{ fontSize: 8, color: "#445566", marginTop: 2, whiteSpace: "pre-wrap" }}>{row.detail.slice(0, 120)}</div>
                )}
              </div>
            );
          }
          const elapsed = row.durationMs;
          return (
            <div
              key={row.runId}
              style={{
                padding: "4px 10px 5px",
                borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                  <span style={{ color: MAGENTA, fontSize: 9, flexShrink: 0 }}>◇</span>
                  <span style={{
                    fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                    color: "#667788",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 150,
                  }}>
                    {row.summary}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <span style={{ color: GREEN, fontSize: 9 }}>✓</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#334455" }}>
                    {formatElapsed(elapsed)}
                  </span>
                </div>
              </div>
              {row.reflectionsPreview && row.reflectionsPreview.length > 0 && (
                <div style={{ marginTop: 3, fontSize: 8, color: "#445566", lineHeight: 1.35 }}>
                  {row.reflectionsPreview[0]!.slice(0, 140)}
                  {row.reflectionsPreview[0]!.length > 140 ? "…" : ""}
                </div>
              )}
            </div>
          );
        })}
        {recent.length === 0 && pulseRecent.length === 0 && !pulseActive && (
          <div style={{ padding: "28px 12px", textAlign: "center", color: "rgba(var(--lim-accent-rgb),0.18)", fontSize: 10, fontFamily: "monospace" }}>
            awaiting activity…
            </div>
        )}
        {recent.map((tc) => {
          const cat   = CATEGORY_META[getToolCategory(tc.name)];
          const sm    = STATUS_META[tc.status] ?? STATUS_META["done"]!;
          const result = toolResultMap.get(tc.callId);
          const isActive = tc.status === "running" || tc.status === "streaming";
          const elapsed = tc.endedAt !== undefined
            ? tc.endedAt - tc.startedAt
            : Date.now() - tc.startedAt;
          const barPct = Math.min(100, (elapsed / MAX_BAR_MS) * 100);

          return (
            <div key={tc.callId} style={{
              padding: "4px 10px 5px",
              borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.035)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
                  <span style={{ color: cat.color, fontSize: 9, flexShrink: 0 }}>{cat.icon}</span>
                  <span style={{
                    fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                    color: isActive ? "#aabbcc" : "#445566",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 118,
                  }}>
                    {tc.name}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <span style={{ color: sm.color, fontSize: 9 }}>{sm.icon}</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: "#334455" }}>
                    {formatElapsed(elapsed)}
                  </span>
                </div>
              </div>
              {/* Timing bar */}
              <div style={{ marginTop: 3, height: 2, borderRadius: 1, background: "rgba(var(--lim-accent-rgb),0.05)", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${barPct}%`,
                  background: result?.ok === false
                    ? "linear-gradient(90deg, rgba(var(--lim-danger-rgb),0.6), rgba(var(--lim-danger-rgb),0.25))"
                    : isActive
                    ? `linear-gradient(90deg,${cat.color}cc,${cat.color}44)`
                    : `linear-gradient(90deg,${cat.color}55,${cat.color}22)`,
                  borderRadius: 1,
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

// ── Stream content preview ────────────────────────────────────────────────────

const PREVIEW_LINES      = 10;
const STREAM_TAIL_LINES  = 6;

const STREAM_CONTENT_FIELD: Record<string, string> = {
  write_file:           "content",
  write_file_if_changed:"content",
  apply_diff:           "diff",
  patch_file:           "new_content",
  execute_code:         "code",
  run_shell:            "command",
  run_background:       "command",
};

function extractStreamingTail(toolName: string, argsJson: string): { lines: string[]; linesAbove: number } | null {
  const field = STREAM_CONTENT_FIELD[toolName];
  if (!field || !argsJson) return null;
  let content: string | null = null;
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    if (typeof parsed[field] === "string") content = parsed[field] as string;
  } catch {
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
    const m = argsJson.match(re);
    if (m && m[1]) {
      content = m[1]
        .replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, "\t")
        .replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (!content || !content.trim()) return null;
  const allLines = content.split("\n");
  return { lines: allLines.slice(-STREAM_TAIL_LINES), linesAbove: Math.max(0, allLines.length - STREAM_TAIL_LINES) };
}

// ── Tool card ─────────────────────────────────────────────────────────────────

type ToolResult = { output: string; ok: boolean };

function ToolCard({ entry, result, compact }: { entry: ToolCallEntry; result?: ToolResult; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const isActive = entry.status === "streaming" || entry.status === "running" || entry.status === "pending_approval";
  const elapsedMs  = useElapsedMs(entry.startedAt, isActive);
  const displayMs  = isActive ? elapsedMs : entry.endedAt !== undefined ? entry.endedAt - entry.startedAt : null;

  const cat = CATEGORY_META[getToolCategory(entry.name)];
  const sm  = STATUS_META[entry.status] ?? STATUS_META["done"]!;
  const arg = parsePrimaryArg(entry.argsJson);

  const streamTail =
    entry.status === "streaming" && !compact
      ? extractStreamingTail(entry.name, entry.argsJson ?? "")
      : null;

  const rawOutput       = result ? result.output.trimEnd() : "";
  const { formatted: formattedOutput } = result ? tryFormatOutput(rawOutput) : { formatted: "" };
  const outputLines     = formattedOutput ? formattedOutput.split("\n") : [];
  const previewCap      = compact ? 3 : PREVIEW_LINES;
  const previewText     = outputLines.slice(0, previewCap).map(l => l.length > 200 ? l.slice(0, 199) + "…" : l).join("\n");
  const extraLines      = Math.max(0, outputLines.length - previewCap);
  const fullText        = outputLines.map(l => l.length > 200 ? l.slice(0, 199) + "…" : l).join("\n");

  return (
    <div style={{ ...styles.toolCard, borderLeftColor: sm.color, borderLeftWidth: 2, borderLeftStyle: "solid" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
          <span style={{ color: cat.color, fontSize: 13, flexShrink: 0 }}>{cat.icon}</span>
          <span style={{ color: "#ccddee", fontWeight: 700, flexShrink: 0, fontSize: 12 }}>{entry.name}</span>
          {arg && (
            <span style={{ color: "#445566", fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {arg}
            </span>
          )}
            </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          {displayMs !== null && <span style={{ color: "#334455", fontSize: 10 }}>{formatElapsed(displayMs)}</span>}
          <span style={{
            color: sm.color, fontSize: 10, fontWeight: 700,
            background: `${sm.color}14`, border: `1px solid ${sm.color}38`,
            borderRadius: 3, padding: "1px 6px", letterSpacing: "0.02em",
          }}>
            {sm.icon} {sm.label}
          </span>
          </div>
      </div>

      {streamTail && (
        <div style={{ marginTop: 7 }}>
          {streamTail.linesAbove > 0 && (
            <div style={{ color: "#223344", fontSize: 10, marginBottom: 3, fontFamily: "monospace" }}>
              ⋯ {streamTail.linesAbove} line{streamTail.linesAbove !== 1 ? "s" : ""} above
            </div>
          )}
          <pre style={{ ...styles.toolOutputPre, color: "#334455", margin: 0, borderColor: "#0d1825" }}>
            {streamTail.lines.join("\n")}
          </pre>
        </div>
      )}

      {isActive && !result && !streamTail && (
        <div style={{ marginTop: 5 }}>
          <span style={{ color: "#223344", fontSize: 10, fontStyle: "italic" }}>running…</span>
            </div>
      )}

      {result && result.output.trim() && (
        <div style={{ marginTop: 6 }}>
          <pre
            style={{
              ...styles.toolOutputPre,
              color: result.ok ? "#556677" : "#ff7766",
              maxHeight: compact ? 120 : 260,
              margin: 0,
            }}
          >
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

// ── Parallel tool group card ──────────────────────────────────────────────────

type ToolCallGroup = { kind: "tool_group"; name: string; entries: ToolCallEntry[] };

type ToolSurface = "clean" | "verbose";

const PARALLEL_WINDOW_MS = 2500;

function parallelGroupMin(toolName: string): number {
  if (toolName === "web_search" || toolName === "web_fetch") return 2;
  return 3;
}

function groupToolCalls(messages: MessageEntry[]): (MessageEntry | ToolCallGroup)[] {
  const out: (MessageEntry | ToolCallGroup)[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.kind !== "tool_call") { out.push(m); i++; continue; }
    const group: ToolCallEntry[] = [m];
    let j = i + 1;
    while (j < messages.length) {
      const next = messages[j]!;
      if (next.kind !== "tool_call" || next.name !== m.name) break;
      if (next.startedAt - m.startedAt > PARALLEL_WINDOW_MS) break;
      group.push(next); j++;
    }
    const min = parallelGroupMin(m.name);
    if (group.length >= min) { out.push({ kind: "tool_group", name: m.name, entries: group }); i = j; }
    else { out.push(m); i++; }
  }
  return out;
}

function ToolGroupCard({
  group,
  toolResultMap,
  surface,
}: {
  group: ToolCallGroup;
  toolResultMap: Map<string, ToolResult>;
  surface: ToolSurface;
}) {
  const [open, setOpen] = useState(false);
  const cat          = CATEGORY_META[getToolCategory(group.name)];
  const doneCount    = group.entries.filter(e => e.status === "done").length;
  const errorCount   = group.entries.filter(e => e.status === "error").length;
  const runningCount = group.entries.filter(e => e.status === "running" || e.status === "streaming").length;
  const allDone      = doneCount + errorCount === group.entries.length;
  const statusColor  = errorCount > 0 ? RED_ERR : allDone ? GREEN : CYAN;
  const statusIcon   = errorCount > 0 ? "✗" : allDone ? "✓" : "⟳";

  return (
    <div style={{ ...styles.toolCard, borderLeftColor: statusColor, borderLeftWidth: 2, borderLeftStyle: "solid" }}>
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
            <ToolCard
              key={entry.callId}
              entry={entry}
              result={toolResultMap.get(entry.callId)}
              compact={surface === "clean"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subtask card ──────────────────────────────────────────────────────────────

function SubtaskView({ entry, surface }: { entry: SubtaskEntry; surface: ToolSurface }) {
  const [showStream, setShowStream] = useState(surface === "verbose");
  useEffect(() => {
    setShowStream(surface === "verbose");
  }, [surface]);
  const statusColor =
    entry.status === "running"  ? CYAN    :
    entry.status === "done"     ? GREEN   :
    entry.status === "error"    ? RED_ERR : "#556677";
  const statusIcon  =
    entry.status === "running"  ? "⟳" :
    entry.status === "done"     ? "✓" :
    entry.status === "error"    ? "✗" : "⊘";
  const outputLines =
    entry.status === "running" && entry.partialOutput
      ? entry.partialOutput.trimEnd().split("\n").filter(l => l.trim()).slice(-4)
      : [];

  const showLines = surface === "verbose" || showStream;

  return (
    <div style={{ ...styles.subtaskCard, marginLeft: entry.depth * 20, borderLeftColor: statusColor }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: MAGENTA }}>{"⤷".repeat(Math.max(1, entry.depth))}</span>
        <span style={{ color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
        <span style={{ color: "#334455", fontSize: 10, fontFamily: "monospace" }}>{entry.taskId.slice(0, 8)}</span>
        <span style={{ color: "#99aabb" }}>
          {entry.goal.length > 120 ? entry.goal.slice(0, 119) + "…" : entry.goal}
        </span>
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
        <button
          type="button"
          onClick={() => setShowStream(true)}
          style={{
            marginTop: 4,
            marginLeft: 20,
            background: "none",
            border: "none",
            color: "#445566",
            fontSize: 10,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Show sub-agent stream
        </button>
      )}
    </div>
  );
}

function ThinkBlock({ entry, surface }: { entry: Extract<MessageEntry, { kind: "think" }>; surface: ToolSurface }) {
  const [thinkOpen, setThinkOpen] = useState(surface === "verbose");
  useEffect(() => {
    setThinkOpen(surface === "verbose");
  }, [surface]);
  if (surface === "clean" && !thinkOpen) {
    return (
      <button
        type="button"
        onClick={() => setThinkOpen(true)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left" as const,
          background: "rgba(0,4,12,0.55)",
          border: "1px solid rgba(var(--lim-accent-rgb),0.08)",
          borderRadius: 4,
          color: "#556677",
          fontSize: 11,
          padding: "6px 10px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ color: "#334455", fontWeight: 700 }}>◈ Reasoning</span>
        <span style={{ color: "#445566", marginLeft: 8 }}>
          ({entry.content.length.toLocaleString()} chars) — expand
        </span>
      </button>
    );
  }
  return (
    <div style={styles.thinkBubble}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#334455", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>◈ REASONING</div>
        {surface === "clean" && (
          <button
            type="button"
            onClick={() => setThinkOpen(false)}
            style={{ background: "none", border: "none", color: "#445566", fontSize: 10, cursor: "pointer" }}
          >
            Collapse
          </button>
        )}
      </div>
      <div style={{ color: "#556677", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 12 }}>
        {entry.content.length > 1200 ? entry.content.slice(0, 1200) + "…" : entry.content}
      </div>
    </div>
  );
}

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageView({
  entry,
  toolResult,
  surface,
}: {
  entry: MessageEntry;
  toolResult?: ToolResult;
  surface: ToolSurface;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div style={styles.userMsg}>
          <span style={{ color: CYAN, fontWeight: 700 }}>You </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
        </div>
      );

    case "assistant":
      return (
        <div style={styles.assistantMsg}>
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
                return <p style={styles.mdParagraph}>{children}</p>;
              },
              img({ src, alt, title }) {
                if (!src) return null;
                const embed = detectVideoEmbed(src);
                if (embed) return <VideoEmbedBlock embed={embed} />;
                return (
                  <span style={{ display: "block", margin: "12px 0" }}>
                    <img src={src} alt={alt ?? ""} title={title ?? ""} loading="lazy" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", display: "block" }} />
                    {alt && <span style={{ display: "block", textAlign: "center", color: "#334455", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>{alt}</span>}
                  </span>
                );
              },
              a({ href, children }) {
                return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, textDecoration: "none", borderBottom: "1px dotted rgba(var(--lim-accent-rgb),0.3)" }}>{children}</a>;
              },
              h1({ children }) { return <h1 style={styles.mdH1}>{children}</h1>; },
              h2({ children }) { return <h2 style={styles.mdH2}>{children}</h2>; },
              h3({ children }) { return <h3 style={styles.mdH3}>{children}</h3>; },
              h4({ children }) { return <h4 style={styles.mdH4}>{children}</h4>; },
              ul({ children }) { return <ul style={styles.mdList}>{children}</ul>; },
              ol({ children }) { return <ol style={styles.mdOrderedList}>{children}</ol>; },
              li({ children }) { return <li style={styles.mdListItem}>{children}</li>; },
              pre({ children }) { return <div style={{ margin: "10px 0" }}>{children}</div>; },
              code({ className, children }) {
                const lang = /language-(\w+)/.exec(className ?? "")?.[1];
                const raw  = String(children).replace(/\n$/, "");
                if (lang) {
                  return (
                    <div style={{ borderRadius: 6, overflow: "hidden", margin: "10px 0", border: "1px solid rgba(var(--lim-accent-rgb),0.1)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", background: "#030810", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.08)" }}>
                        <span style={{ color: "rgba(var(--lim-accent-rgb),0.4)", fontSize: 10, fontFamily: "monospace", letterSpacing: "0.06em" }}>{lang}</span>
                      </div>
                      <SyntaxHighlighter language={lang} style={vscDarkPlus} customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: "#020810" }} showLineNumbers={raw.split("\n").length > 6} lineNumberStyle={{ color: "#223344", minWidth: "2.5em" }} wrapLongLines>
                        {raw}
                      </SyntaxHighlighter>
                    </div>
                  );
                }
                return <code style={styles.mdInlineCode}>{children}</code>;
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
                return <blockquote style={styles.mdQuote}>{children}</blockquote>;
              },
              table({ children }) {
                return <div style={styles.mdTableWrap}><table style={styles.mdTable}>{children}</table></div>;
              },
              th({ children }) { return <th style={styles.mdTableHead}>{children}</th>; },
              td({ children }) { return <td style={styles.mdTableCell}>{children}</td>; },
              hr() {
                return <div style={{ margin: "18px 0", height: 1, background: "linear-gradient(90deg, transparent, rgba(var(--lim-accent-rgb),0.15), rgba(var(--lim-success-rgb),0.33), rgba(var(--lim-accent-rgb),0.15), transparent)" }} />;
              },
            }}
          >
            {entry.text}
          </ReactMarkdown>
          {entry.streaming && <span style={{ color: CYAN, animation: "blink 1s step-end infinite" }}>█</span>}
        </div>
      );

    case "trace":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#223344", fontSize: 9, fontWeight: 700, marginRight: 6 }}>[trace]</span>
          <span style={{ whiteSpace: "pre-wrap", color: "#334455", fontSize: 10 }}>{entry.text}</span>
        </div>
      );

    case "pulse_nudge":
      return (
        <div
          style={{
            margin: "8px 0 4px",
            padding: "9px 12px",
            borderRadius: 6,
            background: "rgba(28, 38, 52, 0.75)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.08)",
          }}
        >
          <span style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: "0.14em", color: "rgba(var(--lim-accent-rgb),0.35)" }}>
            PULSE ·{" "}
          </span>
          <span style={{ fontSize: 12, color: "#aab8c8", whiteSpace: "pre-wrap" }}>{entry.text}</span>
        </div>
      );

    case "provider_retry":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#664422", fontSize: 11 }}>{entry.text}</span>
        </div>
      );

    case "tool_call":
      return <ToolCard entry={entry} result={toolResult} compact={surface === "clean"} />;

    case "tool_result":
      return null;

    case "think":
      return <ThinkBlock entry={entry} surface={surface} />;

    case "plan": {
      const steps = Array.isArray(entry.steps) ? entry.steps : [];
      if (steps.length === 0) return null;
      return (
        <div style={styles.planCard}>
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
        <div style={styles.contextCompressed}>
          ⊙ Context compressed: {entry.beforePct}% → {entry.afterPct}%
          {entry.rounds > 0 && ` (${entry.rounds} round${entry.rounds !== 1 ? "s" : ""} summarised)`}
        </div>
      );

    default:
      return null;
  }
}

// ── File attachment helper ────────────────────────────────────────────────────

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

// ── Main App ──────────────────────────────────────────────────────────────────

export function App() {
  const { state, sendMessage, sendApproval, sendAnswer, sendClearSession, sendPersonaBootstrap } = useSSE();
  const [input,        setInput]        = useState("");
  const [attachments,  setAttachments]  = useState<ImageAttachment[]>([]);
  const [attachError,  setAttachError]  = useState<string | null>(null);
  const [isDragOver,   setIsDragOver]   = useState(false);
  const [askAnswer,    setAskAnswer]    = useState("");
  const [showRawHarness, setShowRawHarness] = useState(false);
  const [draftHistory, setDraftHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [screenshotting, setScreenshotting] = useState(false);
  const [windowWidth,  setWindowWidth]  = useState(window.innerWidth);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [bootstrapInput, setBootstrapInput] = useState("");
  const [bootstrapSubmitting, setBootstrapSubmitting] = useState(false);
  const bootstrapTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFields, setSettingsFields] = useState<HarnessSettingsApiField[]>([]);
  const [settingsTabs, setSettingsTabs] = useState<{ id: string; title: string }[]>([]);
  const [settingsHint, setSettingsHint] = useState("");
  const [settingsProviderModel, setSettingsProviderModel] = useState("");
  const [settingsProviderBase, setSettingsProviderBase] = useState("");
  const [settingsProviderModelLocked, setSettingsProviderModelLocked] = useState(false);
  const [settingsProviderBaseLocked, setSettingsProviderBaseLocked] = useState(false);
  const [settingsProviderApiKeyConfigured, setSettingsProviderApiKeyConfigured] = useState(false);
  const [settingsEnvDraft, setSettingsEnvDraft] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const messagesRef  = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const sessionStartRef = useRef<number | null>(null);

  useEffect(() => {
    applyPersonaDocumentTheme(state.personaUiTheme);
  }, [state.personaUiTheme]);

  useEffect(() => {
    if (!state.personaBootstrapPending || bootstrapSubmitting) return;
    const id = window.requestAnimationFrame(() => {
      bootstrapTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [state.personaBootstrapPending, bootstrapSubmitting]);

  const maxHistory = 30;
  const showPanels = windowWidth >= 900;

  // Track session start time from first message
  useEffect(() => {
    if (state.messages.length > 0 && sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
    }
  }, [state.messages.length]);

  // Session clock
  useEffect(() => {
    const id = window.setInterval(() => {
      if (sessionStartRef.current !== null) {
        setSessionSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Resize listener for responsive panels
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const r = await fetch(`${WEB_SERVER_BASE}/api/settings`);
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as {
        fields: HarnessSettingsApiField[];
        tabs?: { id: string; title: string }[];
        provider?: {
          model?: string;
          baseURL?: string;
          modelLockedByEnv?: boolean;
          baseURLLockedByEnv?: boolean;
          apiKeyConfigured?: boolean;
        };
        hint?: string;
      };
      setSettingsFields(j.fields ?? []);
      setSettingsTabs(j.tabs ?? []);
      setSettingsHint(j.hint ?? "");
      setSettingsProviderModel(j.provider?.model ?? "");
      setSettingsProviderBase(j.provider?.baseURL ?? "");
      setSettingsProviderModelLocked(j.provider?.modelLockedByEnv ?? false);
      setSettingsProviderBaseLocked(j.provider?.baseURLLockedByEnv ?? false);
      setSettingsProviderApiKeyConfigured(j.provider?.apiKeyConfigured ?? false);
      const draft: Record<string, string> = {};
      for (const f of j.fields ?? []) draft[f.key] = f.value;
      setSettingsEnvDraft(draft);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) void loadSettings();
  }, [settingsOpen, loadSettings]);

  const saveSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const env: Record<string, string> = {};
      for (const f of settingsFields) {
        if (f.lockedByEnv) continue;
        const v = settingsEnvDraft[f.key];
        if (v === undefined) continue;
        env[f.key] = v;
      }
      const r = await fetch(`${WEB_SERVER_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: { env: env },
          provider: { model: settingsProviderModel, baseURL: settingsProviderBase },
        }),
      });
      if (!r.ok) {
        let msg = r.statusText;
        try {
          const j = (await r.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          const t = await r.text();
          if (t) msg = t;
        }
        throw new Error(msg);
      }
      setSettingsOpen(false);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingsSaving(false);
    }
  }, [settingsFields, settingsEnvDraft, settingsProviderModel, settingsProviderBase]);

  const pushHistory = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraftHistory(prev => { if (prev[0] === trimmed) return prev; return [trimmed, ...prev].slice(0, maxHistory); });
    setHistoryIndex(-1);
    setHistoryDraft("");
  };

  const syncTextareaHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(40, Math.min(el.scrollHeight, 180))}px`;
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [state.messages]);
  useEffect(() => { syncTextareaHeight(); }, [input]);

  const tryAddAttachments = (next: ImageAttachment[]) => {
    const validation = validateImageAttachments(next, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
    if (!validation.ok) { setAttachError(validation.error); return false; }
    setAttachments(next); setAttachError(null); return true;
  };

  const addFilesAsAttachments = async (files: FileList | File[], source: ImageAttachment["source"]) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const prepared: ImageAttachment[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await fileToDataUrl(file);
      const parsed = parseDataUrlImage(dataUrl);
      if (!parsed.ok) { setAttachError(parsed.error); return; }
      prepared.push({ name: normalizeImageAttachmentName(file.name, `image-${Date.now()}.png`), mimeType: parsed.mimeType, dataUrl, sizeBytes: parsed.sizeBytes, source });
    }
    if (prepared.length === 0) { setAttachError("No supported images found."); return; }
    void tryAddAttachments([...attachments, ...prepared]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.busy || submittingRef.current) return;
    if (!input.trim() && attachments.length === 0) return;
    const validation = validateImageAttachments(attachments, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
    if (!validation.ok) { setAttachError(validation.error); return; }
    submittingRef.current = true;
    const textToSend = input;
    const attachmentsToSend = [...attachments];
    setInput(""); setAttachments([]); setAttachError(null);
    const result = await sendMessage({ text: textToSend, attachments: attachmentsToSend });
    if (!result.ok) { submittingRef.current = false; return; }
    pushHistory(textToSend);
  };

  const applyHistory = (direction: "prev" | "next") => {
    if (draftHistory.length === 0) return;
    if (direction === "prev") {
      if (historyIndex === -1) { setHistoryDraft(input); setHistoryIndex(0); setInput(draftHistory[0] ?? input); return; }
      const nextIndex = Math.min(historyIndex + 1, draftHistory.length - 1);
      setHistoryIndex(nextIndex); setInput(draftHistory[nextIndex] ?? input); return;
    }
    if (historyIndex === -1) return;
    const nextIndex = historyIndex - 1;
    if (nextIndex < 0) { setHistoryIndex(-1); setInput(historyDraft); return; }
    setHistoryIndex(nextIndex); setInput(draftHistory[nextIndex] ?? "");
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLElement>) => {
    const imageFiles = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    await addFilesAsAttachments(imageFiles, "clipboard");
  };

  const handleDrop = async (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault(); setIsDragOver(false);
    if (state.busy) return;
    await addFilesAsAttachments(e.dataTransfer.files, "drop");
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!state.busy) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  };

  const removeAttachmentAt = (idx: number) => {
    const next = attachments.filter((_, i) => i !== idx);
    setAttachments(next);
    if (next.length === 0) setAttachError(null);
  };

  const totalAttachmentKb = Math.round(attachments.reduce((sum, item) => sum + item.sizeBytes, 0) / 1024);

  useEffect(() => { if (state.busy) setIsDragOver(false); }, [state.busy]);
  useEffect(() => { if (state.busy) submittingRef.current = false; }, [state.busy]);

  const canSend =
    !state.busy &&
    !state.personaBootstrapPending &&
    (input.trim().length > 0 || attachments.length > 0);

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

  const handleComposerKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
    const atEnd   = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
    const action  = resolveInputShortcut(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing },
      { canSend, busy: state.busy, cursorAtStart: atStart, cursorAtEnd: atEnd }
    );
    if (action === "none") return;
    e.preventDefault();
    if (action === "send") {
      if (!canSend || submittingRef.current) return;
      submittingRef.current = true;
      const textToSend = input;
      const attachmentsToSend = [...attachments];
      setInput(""); setAttachments([]); setAttachError(null);
      const result = await sendMessage({ text: textToSend, attachments: attachmentsToSend });
      if (!result.ok) { submittingRef.current = false; return; }
      pushHistory(textToSend);
      return;
    }
    if (action === "insert_newline") {
      const start = target.selectionStart;
      const end   = target.selectionEnd;
      const next  = `${input.slice(0, start)}\n${input.slice(end)}`;
      setInput(next);
      queueMicrotask(() => inputRef.current?.setSelectionRange(start + 1, start + 1));
      return;
    }
    if (action === "history_prev")  { applyHistory("prev"); return; }
    if (action === "history_next")  { applyHistory("next"); return; }
    if (action === "clear_draft")   { setInput(""); setHistoryIndex(-1); return; }
    if (action === "clear_session") { if (!state.busy) await sendClearSession(); return; }
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  const pct = state.contextSnapshot ? Math.round(state.contextSnapshot.usageFraction * 100) : 0;

  const surface: ToolSurface = showRawHarness ? "verbose" : "clean";

  const visibleMessages = useMemo(() => {
    return state.messages.filter((entry) => {
      if (!showRawHarness && entry.kind === "trace") return false;
      if (!showRawHarness && entry.kind === "provider_retry") return false;
      if (!showRawHarness && entry.kind === "context_compressed") return false;
      return true;
    });
  }, [state.messages, showRawHarness]);

  const rawHarnessBlob = useMemo(() => {
    const retries = state.messages
      .filter((m): m is Extract<MessageEntry, { kind: "provider_retry" }> => m.kind === "provider_retry")
      .map((m) => m.text);
    const traces = state.messages
      .filter((m): m is Extract<MessageEntry, { kind: "trace" }> => m.kind === "trace")
      .map((m) => m.text);
    const ctx =
      state.lastContextCompress &&
      `[context] compressed ${state.lastContextCompress.beforePct}% → ${state.lastContextCompress.afterPct}% · ${state.lastContextCompress.rounds} rounds`;
    const bits = [...retries, ...(ctx ? [ctx] : []), ...traces];
    return bits.join("\n\n");
  }, [state.messages, state.lastContextCompress]);

  const toolErrorCount = useMemo(
    () => state.messages.filter((m) => m.kind === "tool_result" && !m.ok).length,
    [state.messages]
  );

  const toolResultMap = useMemo(() => {
    const m = new Map<string, ToolResult>();
    for (const msg of state.messages) {
      if (msg.kind === "tool_result") m.set(msg.callId, { output: msg.output, ok: msg.ok });
    }
    return m;
  }, [state.messages]);

  const groupedMessages = groupToolCalls(visibleMessages);

  const activeToolCall = state.messages.slice().reverse().find(
    (m): m is ToolCallEntry =>
      m.kind === "tool_call" && (m.status === "streaming" || m.status === "running" || m.status === "pending_approval")
  );

  const orbState: OrbState =
    !state.connected                                    ? "disconnected" :
    state.pendingApproval                               ? "approval"     :
    activeToolCall?.status === "pending_approval"       ? "approval"     :
    activeToolCall?.status === "running"                ? "running"      :
    state.busy                                          ? "thinking"     :
    state.personalityPulseActive                        ? "pulse"        :
    "idle";

  const allToolCalls = useMemo(
    () => state.messages.filter((m): m is ToolCallEntry => m.kind === "tool_call"),
    [state.messages]
  );
  const toolCount    = allToolCalls.length;
  const msgCount     = state.messages.filter(m => m.kind === "user" || m.kind === "assistant").length;
  const subtasks     = state.messages.filter((m): m is SubtaskEntry => m.kind === "subtask");
  const dreamLabel = presentAutoDream(state.autoDream, { verbosity: state.uiVerbosity }).pillHeadline;
  const pulseChips = useMemo(() => {
    return state.personalityPulseRows
      .filter((r): r is Extract<PersonalityPulseRow, { phase: "completed" }> => r.phase === "completed")
      .slice(-3);
  }, [state.personalityPulseRows]);

  // ── Render ───────────────────────────────────────────────────────────────────

      return (
    <div style={styles.root}>
      <style>{CSS_ANIMATIONS}</style>

      {/* ── Thin header bar ──────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: CYAN, fontWeight: 800, fontSize: 12, letterSpacing: "0.28em", fontFamily: "monospace" }}>{state.personaDisplayLabel}</span>
          {!state.connected && <span style={{ color: RED_ERR, fontSize: 9, fontFamily: "monospace", letterSpacing: "0.06em" }}>● OFFLINE</span>}
          {activeToolCall && showPanels === false && (
            <div style={styles.activityPill}>
              <span style={{ color: CATEGORY_META[getToolCategory(activeToolCall.name)].color }}>
                {CATEGORY_META[getToolCategory(activeToolCall.name)].icon}
              </span>
              <span style={{ color: "#889aaa", fontSize: 10, fontFamily: "monospace" }}>{activeToolCall.name}</span>
              {activeToolCall.status === "pending_approval" && (
                <span style={{ color: MAGENTA, fontSize: 10, fontWeight: 700 }}>— approve?</span>
              )}
            </div>
          )}
          {showPanels === false && state.autoDream.stage !== "idle" && (
            <div style={styles.activityPill}>
              <span style={{ color: state.autoDream.stage === "failed" ? RED_ERR : state.autoDream.stage === "completed" ? GREEN : CYAN }}>
                ◈
              </span>
              <span style={{ color: "#889aaa", fontSize: 10, fontFamily: "monospace" }}>{dreamLabel}</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Slim context bar — only when no left panel */}
          {!showPanels && state.contextSnapshot && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, width: 120 }}>
              <div style={{ flex: 1, height: 2, background: "rgba(var(--lim-accent-rgb),0.08)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct >= 80 ? RED_ERR : pct >= 60 ? AMBER : CYAN, borderRadius: 1, transition: "width 0.4s" }} />
              </div>
              <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.35)", fontSize: 9, fontFamily: "monospace" }}>{pct}%</span>
            </div>
          )}
          <button
            type="button"
            style={styles.headerBtn}
            disabled={state.busy}
            onClick={() => setSettingsOpen(true)}
          >
            SETTINGS
          </button>
          <button type="button" style={styles.headerBtn} disabled={state.busy} onClick={() => void sendClearSession()}>NEW SESSION</button>
          <button type="button" style={{ ...styles.headerBtn, color: showRawHarness ? CYAN : undefined, borderColor: showRawHarness ? "rgba(var(--lim-accent-rgb),0.4)" : undefined }} onClick={() => setShowRawHarness(v => !v)} title={showRawHarness ? "Hide raw trace, retries, and compression lines from the transcript" : "Show raw harness lines in the transcript (noisy)"}>
            RAW {showRawHarness ? "●" : "○"}
          </button>
          <button
            type="button"
            style={{ ...styles.headerBtn, opacity: screenshotting ? 0.5 : 1 }}
            disabled={screenshotting || visibleMessages.length === 0}
            onClick={() => void handleScreenshot()}
            title="Capture session"
          >
            {screenshotting ? "…" : "CAPTURE"}
          </button>
        </div>
      </div>

      {/* ── 3-column body ────────────────────────────────────────────────────── */}
      <div style={styles.body}>

        {/* LEFT: Systems panel */}
        {showPanels && (
          <SystemsPanel
            orbState={orbState}
            pct={pct}
            masked={state.contextSnapshot?.masked}
            connected={state.connected}
            sessionSeconds={sessionSeconds}
            toolCount={toolCount}
            msgCount={msgCount}
            subtasks={subtasks}
            personaName={state.personaName}
            autoDream={state.autoDream}
            uiVerbosity={state.uiVerbosity}
          />
        )}

        {/* CENTER: Comms */}
        <div style={styles.center}>
          {/* Messages */}
          <div ref={messagesRef} style={styles.messages}>
            {visibleMessages.length === 0 && !state.busy && (
              <div style={{ color: "rgba(var(--lim-accent-rgb),0.12)", textAlign: "center", marginTop: 80, fontSize: 13, fontFamily: "monospace", letterSpacing: "0.1em" }}>
                AWAITING INPUT
              </div>
            )}
            {groupedMessages.map((entry, i) => {
              if ("kind" in entry && entry.kind === "tool_group") {
                return (
                  <ToolGroupCard
                    key={`grp-${i}-${entry.name}`}
                    group={entry}
                    toolResultMap={toolResultMap}
                    surface={surface}
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
                />
              );
            })}
            {state.error && (
              <div style={{ color: RED_ERR, padding: "8px 0", fontSize: 12, fontFamily: "monospace" }}>
                ✗ {state.error}
              </div>
            )}
            {!showRawHarness && rawHarnessBlob.trim().length > 0 && (
              <details style={{ marginTop: 10, borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)", paddingTop: 8 }}>
                <summary style={{ color: "#556677", fontSize: 11, cursor: "pointer", userSelect: "none" }}>
                  Full harness trace ({rawHarnessBlob.length.toLocaleString()} chars) — optional
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    maxHeight: 220,
                    overflow: "auto",
                    fontSize: 10,
                    color: "#445566",
                    background: "rgba(0,4,12,0.75)",
                    border: "1px solid rgba(var(--lim-accent-rgb),0.06)",
                    borderRadius: 4,
                    padding: 10,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {rawHarnessBlob}
                </pre>
              </details>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={styles.sessionFooterStrip}>
            <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.45)" }}>CTX {pct}%</span>
            {state.lastTurnProviderRetries > 0 && (
              <span style={{ color: AMBER }}>
                {state.lastTurnProviderRetries} provider retr{state.lastTurnProviderRetries === 1 ? "y" : "ies"} (recovered)
              </span>
            )}
            {toolErrorCount > 0 && (
              <span style={{ color: RED_ERR }}>{toolErrorCount} tool error{toolErrorCount === 1 ? "" : "s"}</span>
            )}
            {state.lastContextCompress && (
              <span style={{ color: "#556677" }}>
                Compressed {state.lastContextCompress.beforePct}% → {state.lastContextCompress.afterPct}%
              </span>
            )}
            <span style={{ color: "#334455", marginLeft: "auto" }}>
              {surface === "clean" ? "Clean view — toggle RAW for full harness lines" : "Verbose view"}
            </span>
          </div>
          {state.heartbeatEnabled && state.heartbeatUiStrip && (state.personalityPulseActive || pulseChips.length > 0) && (
            <div
              style={{
                padding: "5px 12px 6px",
                borderTop: "1px solid rgba(var(--lim-accent-rgb),0.05)",
                background: "rgba(0,6,14,0.35)",
                fontFamily: "monospace",
                fontSize: 9,
                color: "rgba(var(--lim-accent-rgb),0.35)",
                letterSpacing: "0.06em",
              }}
            >
              <span style={{ color: MAGENTA }}>PULSE</span>
              {state.personalityPulseActive && <span style={{ marginLeft: 8, color: "#8899aa" }}>syncing…</span>}
              {pulseChips.map((c) => (
                <span
                  key={c.runId}
                  title={c.summary}
                  style={{
                    marginLeft: 8,
                    padding: "1px 6px",
                    borderRadius: 3,
                    border: "1px solid rgba(var(--lim-accent-rgb),0.1)",
                    color: "#778899",
                    maxWidth: 160,
                    display: "inline-block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "middle",
                  }}
                >
                  {c.summary.slice(0, 48)}
                  {c.summary.length > 48 ? "…" : ""}
                </span>
              ))}
            </div>
          )}
          <form
            style={{
              ...styles.inputArea,
              borderTopColor: isDragOver ? CYAN : "rgba(var(--lim-accent-rgb),0.07)",
              outline: isDragOver ? `1px dashed rgba(var(--lim-accent-rgb),0.4)` : "none",
            }}
            onSubmit={(e) => void handleSubmit(e)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => void handleDrop(e)}
          >
            {attachments.length > 0 && (
              <div style={styles.attachmentsRow}>
                {attachments.map((attachment, idx) => (
                  <div key={`${attachment.name}-${idx}`} style={styles.attachmentChip}>
                    <img src={attachment.dataUrl} alt={attachment.name} style={styles.attachmentPreview} />
                    <span style={styles.attachmentLabel}>{attachment.name} ({Math.round(attachment.sizeBytes / 1024)} KB)</span>
                    <button type="button" style={styles.attachmentRemove} onClick={() => removeAttachmentAt(idx)} disabled={state.busy}>×</button>
                  </div>
                ))}
                <span style={styles.attachmentMeta}>{attachments.length} image{attachments.length === 1 ? "" : "s"} ({totalAttachmentKb} KB)</span>
              </div>
            )}
            {attachError && <div style={styles.attachmentError}>{attachError}</div>}
            <div style={styles.composerRow}>
              <textarea
                id="chat-message-input"
                name="message"
                ref={inputRef}
                rows={1}
                style={styles.textarea}
                value={input}
                onChange={e => { setInput(e.target.value); if (historyIndex !== -1) setHistoryIndex(-1); }}
                onKeyDown={e => void handleComposerKeyDown(e)}
                onPaste={e => void handlePaste(e)}
                placeholder={state.busy ? "processing…" : "transmit…"}
                disabled={state.busy || !state.connected}
              />
              <button type="submit" style={{
                ...styles.btn,
                background: canSend ? "rgba(0,60,100,0.8)" : "rgba(0,6,14,0.6)",
                borderColor: canSend ? "rgba(var(--lim-accent-rgb),0.4)" : "rgba(var(--lim-accent-rgb),0.08)",
                color: canSend ? CYAN : "rgba(var(--lim-accent-rgb),0.2)",
                cursor: canSend ? "pointer" : "default",
                fontFamily: "monospace",
                letterSpacing: "0.1em",
                fontSize: 11,
              }} disabled={!canSend}>
                SEND
              </button>
            </div>
            <div style={styles.shortcutHint}>
              Enter send · Shift+Enter newline · Ctrl/Cmd+K clear · Ctrl/Cmd+Shift+L new session
            </div>
          </form>
        </div>

        {/* RIGHT: Activity stream */}
        {showPanels && (
          <ActivityStream
            toolCalls={allToolCalls}
            toolResultMap={toolResultMap}
            pulseActive={state.personalityPulseActive}
            pulseRows={state.personalityPulseRows}
          />
        )}
      </div>

      {/* ── Settings modal ─────────────────────────────────────────────────────── */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsError(null);
        }}
        hint={settingsHint}
        loading={settingsLoading}
        error={settingsError}
        saving={settingsSaving}
        agentBusy={state.busy}
        tabs={settingsTabs}
        fields={settingsFields}
        providerModel={settingsProviderModel}
        providerBase={settingsProviderBase}
        providerModelLocked={settingsProviderModelLocked}
        providerBaseLocked={settingsProviderBaseLocked}
        providerApiKeyConfigured={settingsProviderApiKeyConfigured}
        onProviderModel={setSettingsProviderModel}
        onProviderBase={setSettingsProviderBase}
        envDraft={settingsEnvDraft}
        onEnvChange={(key, v) =>
          setSettingsEnvDraft((d) => ({
            ...d,
            [key]: v,
          }))
        }
        onSave={() => void saveSettings()}
      />

      {/* ── Approval modal ────────────────────────────────────────────────────── */}
      {state.pendingApproval && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <span style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, borderTop: `2px solid ${MAGENTA}`, borderLeft: `2px solid ${MAGENTA}` }} />
            <span style={{ position: "absolute", top: 0, right: 0, width: 12, height: 12, borderTop: `2px solid ${MAGENTA}`, borderRight: `2px solid ${MAGENTA}` }} />
            <span style={{ position: "absolute", bottom: 0, left: 0, width: 12, height: 12, borderBottom: `2px solid ${MAGENTA}`, borderLeft: `2px solid ${MAGENTA}` }} />
            <span style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderBottom: `2px solid ${MAGENTA}`, borderRight: `2px solid ${MAGENTA}` }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: MAGENTA, fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", fontFamily: "monospace" }}>⚠ AUTHORIZATION REQUIRED</span>
                <span style={{
                  color: CATEGORY_META[getToolCategory(state.pendingApproval.name)].color,
                  fontWeight: 700, fontSize: 13, fontFamily: "monospace",
                }}>
                  {CATEGORY_META[getToolCategory(state.pendingApproval.name)].icon}{" "}
                  {state.pendingApproval.name}
                </span>
              </div>
              <ApprovalCountdown receivedAt={state.pendingApproval.receivedAt} approvalTimeoutMs={state.pendingApproval.approvalTimeoutMs} />
            </div>

            <div style={styles.argsTable}>
              {Object.entries(state.pendingApproval.args)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => {
                  const raw = typeof v === "string" ? v.replace(/\n/g, "↩").slice(0, 300) : JSON.stringify(v, null, 2).slice(0, 300);
                  return (
                    <div key={k} style={styles.argsRow}>
                      <span style={styles.argsKey}>{k}</span>
                      <span style={styles.argsVal}>{raw}</span>
                    </div>
                  );
                })}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                style={{ ...styles.btn, background: "rgba(0,30,12,0.8)", borderColor: `rgba(var(--lim-success-rgb),0.3)`, color: GREEN, flex: 1, letterSpacing: "0.08em", fontSize: 11, fontFamily: "monospace" }}
                onClick={() => sendApproval(state.pendingApproval!.callId, { decision: "approve" })}
              >
                ✓ AUTHORIZE
              </button>
              <button
                style={{ ...styles.btn, background: "rgba(30,4,8,0.8)", borderColor: `rgba(var(--lim-danger-rgb),0.3)`, color: RED_ERR, flex: 1, letterSpacing: "0.08em", fontSize: 11, fontFamily: "monospace" }}
                onClick={() => sendApproval(state.pendingApproval!.callId, { decision: "reject", reason: "Rejected by user" })}
              >
                ✗ DENY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Persona bootstrap modal ───────────────────────────────────────────── */}
      {state.personaBootstrapPending && (
        <div
          style={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="persona-bootstrap-title"
        >
          <div style={styles.modalBox}>
            <div
              id="persona-bootstrap-title"
              style={{ color: CYAN, fontWeight: 700, marginBottom: 6, fontSize: 11, letterSpacing: "0.12em", fontFamily: "monospace" }}
            >
              ◆ WELCOME — PERSONALITY
            </div>
            <div style={{ marginBottom: 10, color: "#c8d4e0", lineHeight: 1.65, fontSize: 14 }}>
              Choose how the assistant should <strong style={{ color: "#e8f0ff" }}>sound</strong> (tone, pace, humor). Tools,
              safety, and task behavior stay the same. You can change this anytime in Settings or with{" "}
              <code style={{ fontSize: 12, color: CYAN }}>set_persona</code>.
            </div>
            <div style={{ marginBottom: 10, color: "#8899aa", fontSize: 12, lineHeight: 1.5 }}>
              Try a quick start (tap to fill the box), then edit freely:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {PERSONA_QUICK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={bootstrapSubmitting}
                  onClick={() => setBootstrapInput(preset)}
                  style={{
                    ...styles.btn,
                    fontSize: 11,
                    padding: "6px 10px",
                    letterSpacing: "0.04em",
                    maxWidth: "100%",
                    textAlign: "left",
                    whiteSpace: "normal",
                    lineHeight: 1.35,
                  }}
                >
                  {preset.length > 52 ? `${preset.slice(0, 50)}…` : preset}
                </button>
              ))}
            </div>
            {bootstrapSubmitting && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 10px",
                  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
                  background: "rgba(var(--lim-accent-rgb),0.06)",
                  color: CYAN,
                  fontSize: 12,
                  fontFamily: "monospace",
                  letterSpacing: "0.03em",
                }}
              >
                {state.personaBootstrapProgress ?? "Working…"}
                {state.personaBootstrapStage
                  ? ` · ${personaBootstrapStageHint(state.personaBootstrapStage)}`
                  : ""}
              </div>
            )}
            <textarea
              ref={bootstrapTextareaRef}
              style={{ ...styles.textarea, minHeight: 110, width: "100%" }}
              value={bootstrapInput}
              onChange={(e) => setBootstrapInput(e.target.value)}
              placeholder="e.g. Calm, precise operations advisor with dry wit and concise answers…"
              disabled={bootstrapSubmitting}
              autoFocus
              aria-label="Describe your preferred assistant voice"
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...styles.btn, flex: "1 1 140px" }}
                disabled={bootstrapSubmitting || !bootstrapInput.trim()}
                onClick={async () => {
                  setBootstrapSubmitting(true);
                  const r = await sendPersonaBootstrap(bootstrapInput.trim());
                  if (r.ok) setBootstrapInput("");
                  setBootstrapSubmitting(false);
                }}
              >
                SAVE VOICE · START
              </button>
              {state.personaBootstrapAllowSkip && (
                <button
                  type="button"
                  style={{ ...styles.btn, flex: "1 1 140px" }}
                  disabled={bootstrapSubmitting}
                  onClick={async () => {
                    setBootstrapSubmitting(true);
                    await sendPersonaBootstrap("", { skip: true });
                    setBootstrapInput("");
                    setBootstrapSubmitting(false);
                  }}
                  title="Keeps the default Liminal voice and marks this step complete. You can personalize later."
                >
                  USE DEFAULT VOICE
                </button>
              )}
            </div>
            {state.personaBootstrapAllowSkip && (
              <div style={{ marginTop: 10, color: "#6a7a8a", fontSize: 11, lineHeight: 1.45 }}>
                &quot;Use default voice&quot; skips generation, uses the built-in voice, and completes first-run setup.
                No API calls for persona.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Ask-user modal ────────────────────────────────────────────────────── */}
      {state.pendingAskUser && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <span style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, borderTop: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}` }} />
            <span style={{ position: "absolute", top: 0, right: 0, width: 12, height: 12, borderTop: `2px solid ${CYAN}`, borderRight: `2px solid ${CYAN}` }} />
            <span style={{ position: "absolute", bottom: 0, left: 0, width: 12, height: 12, borderBottom: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}` }} />
            <span style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderBottom: `2px solid ${CYAN}`, borderRight: `2px solid ${CYAN}` }} />

            <div style={{ color: CYAN, fontWeight: 700, marginBottom: 12, fontSize: 11, letterSpacing: "0.12em", fontFamily: "monospace" }}>
              ◆ INPUT REQUIRED
            </div>
            <div style={{ marginBottom: 14, color: "#aabbcc", lineHeight: 1.65, fontSize: 14, whiteSpace: "pre-wrap" }}>
              {state.pendingAskUser.prompt}
            </div>
            <input
              id="ask-user-answer"
              name="askUserAnswer"
              autoFocus
              style={styles.answerInput}
              value={askAnswer}
              onChange={e => setAskAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && askAnswer.trim()) { sendAnswer(askAnswer.trim()); setAskAnswer(""); } }}
              placeholder="Response…"
            />
            <button
              style={{ ...styles.btn, background: "rgba(0,20,40,0.8)", borderColor: `rgba(var(--lim-accent-rgb),0.3)`, color: CYAN, marginTop: 10, width: "100%", letterSpacing: "0.1em", fontSize: 11, fontFamily: "monospace" }}
              onClick={() => { if (askAnswer.trim()) { sendAnswer(askAnswer.trim()); setAskAnswer(""); } }}
            >
              TRANSMIT
            </button>
          </div>
        </div>
      )}
        </div>
      );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: BG,
    color: "#aabbcc",
    fontFamily: "system-ui, -apple-system, sans-serif",
    backgroundImage: [
      "radial-gradient(ellipse at 50% 0%, rgba(0,40,80,0.35) 0%, rgba(2,4,8,0) 62%)",
      "linear-gradient(rgba(var(--lim-accent-rgb),0.022) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(var(--lim-accent-rgb),0.022) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: "auto, 44px 44px, 44px 44px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 14px",
    borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)",
    background: "rgba(2,4,8,0.98)",
    flexShrink: 0,
    gap: 10,
  },
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    minWidth: 0,
  },
  activityPill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(var(--lim-accent-rgb),0.06)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
    borderRadius: 20,
    padding: "2px 10px",
    fontSize: 10,
  },
  headerBtn: {
    background: "transparent",
    border: "1px solid rgba(var(--lim-accent-rgb),0.18)",
    borderRadius: 2,
    color: "rgba(var(--lim-accent-rgb),0.45)",
    padding: "3px 10px",
    fontSize: 9,
    cursor: "pointer",
    fontFamily: "monospace",
    letterSpacing: "0.1em",
    transition: "border-color 0.15s, color 0.15s",
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "14px 20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
  },
  sessionFooterStrip: {
    flexShrink: 0,
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: 12,
    padding: "6px 18px 8px",
    fontSize: 10,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    borderTop: "1px solid rgba(var(--lim-accent-rgb),0.06)",
    color: "#556677",
    background: "rgba(1,3,8,0.96)",
  },
  userMsg: {
    padding: "8px 12px",
    background: "rgba(0,30,55,0.4)",
    borderRadius: 4,
    borderLeft: `2px solid ${CYAN}`,
    lineHeight: 1.5,
    boxShadow: "inset 0 0 20px rgba(var(--lim-accent-rgb),0.02)",
  },
  assistantMsg: {
    padding: "5px 0",
    color: "#44dd88",
    lineHeight: 1.65,
  },
  mdParagraph:    { margin: "0 0 10px", whiteSpace: "normal" as const, lineHeight: 1.72 },
  mdList:         { margin: "0 0 10px 22px", lineHeight: 1.72 },
  mdOrderedList:  { margin: "0 0 10px 22px", lineHeight: 1.72 },
  mdListItem:     { margin: "3px 0" },
  mdH1: { fontSize: 22, margin: "18px 0 10px", color: "#7cf5a9", borderBottom: "1px solid rgba(var(--lim-success-rgb),0.15)", paddingBottom: 5, fontWeight: 700 },
  mdH2: { fontSize: 18, margin: "16px 0 8px", color: CYAN, fontWeight: 700 },
  mdH3: { fontSize: 15, margin: "12px 0 6px", color: "#cc88ff", fontWeight: 600 },
  mdH4: { fontSize: 13, margin: "10px 0 4px", color: AMBER, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em" },
  mdInlineCode: {
    background: "rgba(0,10,22,0.8)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.12)",
    borderRadius: 3,
    padding: "1px 5px",
    color: GREEN,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.9em",
  },
  mdQuote: {
    margin: "12px 0", padding: "8px 14px",
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.25)",
    color: "#667788", fontStyle: "italic" as const,
    background: "rgba(0,10,20,0.5)", borderRadius: "0 4px 4px 0",
  },
  mdTableWrap: { overflowX: "auto" as const, margin: "12px 0", borderRadius: 5, overflow: "hidden" as const },
  mdTable:     { width: "100%", borderCollapse: "collapse" as const, background: "rgba(0,6,14,0.8)" },
  mdTableHead: { textAlign: "left" as const, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", padding: "7px 12px", background: "rgba(0,12,25,0.9)", color: "#889aaa", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em" },
  mdTableCell: { border: "1px solid rgba(var(--lim-accent-rgb),0.07)", padding: "6px 12px", verticalAlign: "top" as const, color: "#778899" },
  toolCard: {
    borderRadius: 3,
    padding: "6px 10px",
    background: "rgba(0,6,16,0.8)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.07)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 11,
  },
  toolOutputPre: {
    margin: 0, padding: "5px 9px",
    background: "rgba(0,4,10,0.8)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.06)",
    borderRadius: 3, fontSize: 10,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const,
    lineHeight: 1.5, maxHeight: 260, overflowY: "auto" as const,
  },
  thinkBubble: {
    padding: "7px 11px",
    background: "rgba(0,4,12,0.6)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.06)",
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.18)",
    borderRadius: 3, lineHeight: 1.5,
  },
  planCard: {
    padding: "9px 14px",
    background: "rgba(0,8,20,0.7)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.1)",
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.35)",
    borderRadius: 3,
  },
  subtaskCard: {
    padding: "5px 11px",
    background: "rgba(0,5,14,0.7)",
    borderRadius: 3, fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    borderLeft: `2px solid ${CYAN}`,
    color: "#889aaa",
  },
  contextCompressed: {
    padding: "4px 10px",
    color: "#334455",
    fontSize: 10,
    fontStyle: "italic" as const,
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.15)",
    fontFamily: "monospace",
  },
  traceLine: {
    paddingLeft: 8,
    borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.07)",
    lineHeight: 1.4,
    opacity: 0.65,
  },
  inputArea: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    padding: "10px 14px",
    background: "rgba(2,4,8,0.98)",
    borderTopWidth: 1,
    borderTopStyle: "solid" as const,
    flexShrink: 0,
  },
  composerRow: {
    display: "flex",
    gap: 7,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    background: "rgba(0,8,18,0.85)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.14)",
    borderRadius: 3,
    color: "#aabbcc",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    resize: "none" as const,
    minHeight: 40,
    maxHeight: 180,
    overflowY: "auto" as const,
    lineHeight: 1.4,
  },
  shortcutHint: {
    fontSize: 9,
    color: "rgba(var(--lim-accent-rgb),0.2)",
    letterSpacing: "0.03em",
    fontFamily: "monospace",
  },
  btn: {
    border: "1px solid rgba(var(--lim-accent-rgb),0.18)",
    borderRadius: 3,
    color: "#aabbcc",
    padding: "8px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "rgba(0,8,18,0.8)",
  },
  modal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,1,4,0.88)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    backdropFilter: "blur(6px)",
  },
  modalBox: {
    background: "rgba(2,6,18,0.99)",
    border: `1px solid rgba(var(--lim-accent-rgb),0.2)`,
    borderRadius: 4,
    padding: 22,
    width: 520,
    maxWidth: "90vw",
    maxHeight: "80vh",
    overflowY: "auto" as const,
    boxShadow: "0 0 50px rgba(var(--lim-accent-rgb),0.08), 0 0 100px rgba(0,0,0,0.6)",
    position: "relative" as const,
  },
  argsTable: {
    background: "rgba(0,4,12,0.8)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.1)",
    borderRadius: 3,
    overflow: "hidden" as const,
  },
  argsRow: {
    display: "flex",
    borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.05)",
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  argsKey: {
    color: "rgba(var(--lim-accent-rgb),0.5)",
    padding: "5px 10px",
    background: "rgba(0,8,20,0.8)",
    flexShrink: 0,
    minWidth: 100,
    borderRight: "1px solid rgba(var(--lim-accent-rgb),0.08)",
    fontWeight: 700,
  },
  argsVal: {
    color: "#778899",
    padding: "5px 10px",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    flex: 1,
  },
  answerInput: {
    width: "100%",
    background: "rgba(0,6,16,0.9)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.18)",
    borderRadius: 3,
    color: "#aabbcc",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  attachmentsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 7,
    alignItems: "center",
  },
  attachmentChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(0,14,28,0.8)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
    borderRadius: 3,
    padding: "3px 6px",
  },
  attachmentPreview: { width: 20, height: 20, objectFit: "cover" as const, borderRadius: 2 },
  attachmentLabel:  { fontSize: 10, color: "#667788", fontFamily: "monospace" },
  attachmentRemove: { border: "none", background: "transparent", color: RED_ERR, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 },
  attachmentMeta:   { fontSize: 10, color: "rgba(var(--lim-accent-rgb),0.25)", fontFamily: "monospace" },
  attachmentError:  { color: RED_ERR, fontSize: 11, fontFamily: "monospace" },
};
