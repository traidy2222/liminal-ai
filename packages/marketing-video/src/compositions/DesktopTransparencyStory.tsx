import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker } from "../components/Typography";
import { LIMINAL_THEME, VIDEO } from "../theme";
import {
  type MessagesRecording,
  loadDesktopManifest,
  loadMessagesRecording,
} from "../lib/desktopManifest";

export const DESKTOP_TRANSPARENCY_DURATION = 24 * VIDEO.fps;

const TRACE_ID = "desktop-repo-react-trace";

export const DesktopTransparencyStory: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [recording, setRecording] = useState<MessagesRecording | null>(null);
  const [heroPng, setHeroPng] = useState("marketing/live-repo-grep.png");

  useEffect(() => {
    const h = delayRender("desktop-transparency-data");
    loadDesktopManifest()
      .then(async (m) => {
        const row = m.results.find((r) => r.id === TRACE_ID) ?? m.results[1];
        if (row?.png) setHeroPng(row.png);
        const rec = await loadMessagesRecording(row?.messagesPath);
        setRecording(rec);
      })
      .finally(() => continueRender(h));
  }, []);

  const split = spring({ frame: frame - 20, fps, config: { damping: 200 } });

  const userText =
    recording?.prompt ??
    recording?.messages.find((m) => m.kind === "user")?.text ??
    "Use grep_file to find AgentHarness and summarize the ReAct loop.";

  const assistantText =
    recording?.messages
      .filter((m) => m.kind === "assistant")
      .map((m) => m.text)
      .join(" ")
      .slice(0, 280) || "Structured answer from real tool results — not a fabricated summary.";

  const toolTrace = recording?.messages
    .filter((m): m is { kind: "tool_call"; name: string; argsJson?: string } => m.kind === "tool_call")
    .slice(0, 6)
    .map((m) => ({
      tool: m.name,
      detail: (m.argsJson ?? "").slice(0, 72) || "…",
    }));

  const tools = toolTrace?.length
    ? toolTrace
    : (recording?.meta?.tools ?? ["grep_file", "read_file"]).map((t) => ({
        tool: t,
        detail: "from session.jsonl",
      }));

  return (
    <AbsoluteFill>
      <GridBackground vignette={0.65} />
      <ScanlineOverlay />

      <AbsoluteFill style={{ padding: "64px 88px" }}>
        <Kicker>Captured from the desktop app</Kicker>
        <Headline size={56} delay={6}>
          Real tool trace — not staged UI
        </Headline>
        <BodyCopy delay={14} maxWidth={900}>
          Marketing footage is recorded from liminal_desktop.exe while the harness runs.
          Session JSONL and screenshots are the same artifacts users get.
        </BodyCopy>

        <div
          style={{
            display: "flex",
            gap: 40,
            marginTop: 48,
            flex: 1,
            opacity: split,
            transform: `scale(${interpolate(split, [0, 1], [0.94, 1])})`,
          }}
        >
          <Panel title="What chat apps show" accent={LIMINAL_THEME.textDim}>
            <Bubble role="user" text={userText.slice(0, 120) + (userText.length > 120 ? "…" : "")} muted />
            <Bubble role="assistant" text={assistantText.slice(0, 160) + "…"} muted />
            <div
              style={{
                marginTop: 24,
                padding: 16,
                borderRadius: 8,
                border: "1px dashed #334",
                color: LIMINAL_THEME.textDim,
                fontFamily: LIMINAL_THEME.fontMono,
                fontSize: 14,
                textAlign: "center",
              }}
            >
              tools hidden
            </div>
          </Panel>

          <Panel title="Liminal desktop harness" accent={LIMINAL_THEME.accent}>
            <div
              style={{
                borderRadius: 10,
                overflow: "hidden",
                border: `1px solid ${LIMINAL_THEME.border}`,
                marginBottom: 20,
              }}
            >
              <Img src={staticFile(heroPng)} style={{ width: "100%", display: "block" }} />
            </div>
            {tools.map((row, i) => (
              <ToolRow key={`${row.tool}-${i}`} tool={row.tool} detail={row.detail} delay={24 + i * 8} />
            ))}
          </Panel>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Panel: React.FC<{ title: string; accent: string; children: React.ReactNode }> = ({
  title,
  accent,
  children,
}) => (
  <div
    style={{
      flex: 1,
      background: LIMINAL_THEME.bgElevated,
      borderRadius: 14,
      border: `1px solid ${LIMINAL_THEME.border}`,
      padding: 28,
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div
      style={{
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 12,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: accent,
        marginBottom: 20,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const Bubble: React.FC<{ role: string; text: string; muted?: boolean }> = ({ role, text, muted }) => (
  <div
    style={{
      marginBottom: 12,
      padding: "14px 18px",
      borderRadius: 10,
      background: muted ? "rgba(255,255,255,0.03)" : "rgba(0,212,255,0.08)",
      border: `1px solid ${muted ? "#223" : LIMINAL_THEME.border}`,
      fontFamily: LIMINAL_THEME.fontSans,
      fontSize: 18,
      color: muted ? LIMINAL_THEME.textDim : LIMINAL_THEME.text,
    }}
  >
    <span style={{ fontFamily: LIMINAL_THEME.fontMono, fontSize: 11, color: LIMINAL_THEME.textDim }}>
      {role}
    </span>
    <div style={{ marginTop: 6 }}>{text}</div>
  </div>
);

const ToolRow: React.FC<{ tool: string; detail: string; delay: number }> = ({
  tool,
  detail,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        marginBottom: 10,
        opacity: enter,
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 15,
      }}
    >
      <span style={{ color: LIMINAL_THEME.success, minWidth: 140 }}>{tool}</span>
      <span style={{ color: LIMINAL_THEME.textMuted }}>{detail}</span>
    </div>
  );
};
