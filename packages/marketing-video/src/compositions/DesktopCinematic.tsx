import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AppWindow } from "../cinematic/AppWindow";
import { CinematicBackdrop } from "../cinematic/CinematicBackdrop";
import {
  KickerLine,
  MonoPill,
  SubCopy,
  UnderlineSweep,
  WordsReveal,
} from "../cinematic/KineticText";
import { TraceCascade, type TraceStep } from "../cinematic/TraceCascade";
import { CINEMA, CINEMA_VIDEO, easeInOutSine } from "../cinematic/cinema";

const FPS = CINEMA_VIDEO.fps;

const B1 = 5 * FPS; //   0–5s   cold open
const B2 = 9 * FPS; //   5–14s  hero window
const B3 = 12 * FPS; // 14–26s  real session trace
const B4 = 10 * FPS; // 26–36s  one agent, every surface
const B5 = 6 * FPS; //  36–42s  integrations wall
const B6 = 6 * FPS; //  42–48s  CTA

export const DESKTOP_CINEMATIC_DURATION = B1 + B2 + B3 + B4 + B5 + B6;

const XFADE = 14;

/** Beat wrapper: crossfade edges + slow push-in for a continuous camera feel. */
const Beat: React.FC<{
  from: number;
  duration: number;
  zoom?: number;
  children: React.ReactNode;
}> = ({ from, duration, zoom = 1.035, children }) => {
  const frame = useCurrentFrame();
  const local = frame - from;
  const fadeIn = interpolate(local, [0, XFADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(local, [duration - XFADE, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const push = interpolate(local, [0, duration], [1, zoom], {
    easing: easeInOutSine,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `scale(${push})` }}>
        {children}
      </AbsoluteFill>
    </Sequence>
  );
};

/* ── Beat 1 — cold open ──────────────────────────────────────────────────── */

const ColdOpen: React.FC = () => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 42,
      padding: "0 160px",
    }}
  >
    <KickerLine delay={6}>Vireon Dynamics · Liminal Desktop</KickerLine>
    <WordsReveal
      text="Work doesn't happen in a chat box."
      delay={26}
      size={104}
      align="center"
      accentWords={[5, 6]}
      maxWidth={1400}
    />
    <UnderlineSweep delay={92} width={520} />
  </AbsoluteFill>
);

/* ── Beat 2 — hero window ────────────────────────────────────────────────── */

const HeroWindow: React.FC = () => (
  <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 110px", gap: 70 }}>
    <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 34, flexShrink: 0 }}>
      <KickerLine delay={8}>The desktop app</KickerLine>
      <WordsReveal
        text="One agent. On your machine."
        delay={20}
        size={84}
        accentWords={[0, 1]}
        maxWidth={620}
      />
      <SubCopy delay={66} size={29} maxWidth={600}>
        Email, documents, spreadsheets, code, and research — one assistant,
        connected to your real tools, running locally.
      </SubCopy>
      <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
        <MonoPill delay={96}>your API keys</MonoPill>
        <MonoPill delay={106} color={CINEMA.cyan}>
          approval-gated
        </MonoPill>
      </div>
    </div>
    <div style={{ flex: 1 }}>
      <AppWindow src="marketing/desktop-code-ship-test.png" delay={14} width="100%" sweepAt={70} />
    </div>
  </AbsoluteFill>
);

/* ── Beat 3 — real session trace ─────────────────────────────────────────── */

const TRACE_STEPS: TraceStep[] = [
  {
    kind: "prompt",
    at: 18,
    text: "Implement slugify, add tests, run them. Fix anything that fails.",
  },
  { kind: "tool", name: "plan", detail: "3 steps — implement → test → verify", at: 110, settleAt: 150 },
  {
    kind: "tool",
    name: "write_file",
    detail: "marketing-capture/slugify.ts",
    at: 170,
    settleAt: 230,
  },
  {
    kind: "tool",
    name: "write_file",
    detail: "marketing-capture/slugify.test.ts — 3 cases",
    at: 250,
    settleAt: 310,
  },
  {
    kind: "tool",
    name: "run_shell",
    detail: "node --test marketing-capture/",
    at: 330,
    settleAt: 430,
    color: CINEMA.cyan,
  },
  { kind: "assistant", at: 450, text: "All three tests pass. slugify(\"Foo Bar!\") → \"foo-bar\"." },
  { kind: "result", at: 500, label: "tests 3 · pass 3 · PASS" },
];

const SessionTrace: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 22, alignItems: "center" }}>
      <KickerLine delay={4}>A real session — not a sizzle mock</KickerLine>
      <WordsReveal
        text="Every step happens on screen."
        delay={14}
        size={62}
        align="center"
        accentWords={[3, 4, 5]}
      />
    </div>
    <TraceCascade steps={TRACE_STEPS} width={1240} />
  </AbsoluteFill>
);

/* ── Beat 4 — one agent, every surface ───────────────────────────────────── */

const SURFACES = [
  { label: "Email & calendar", detail: "Gmail · Outlook — drafted in your voice" },
  { label: "Documents & spreadsheets", detail: "PPTX · DOCX · PDF · Sheets · Excel" },
  { label: "Research with receipts", detail: "multi-source, cited, saved locally" },
  { label: "Code & terminal", detail: "edit, test, commit — with approvals" },
];

const SurfaceRow: React.FC<{ label: string; detail: string; delay: number }> = ({
  label,
  detail,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 32, stiffness: 150, mass: 0.85 } });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 26,
        opacity: p,
        transform: `translateX(${(1 - p) * -48}px)`,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: CINEMA.emerald,
          boxShadow: `0 0 24px ${CINEMA.emerald}aa`,
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontFamily: CINEMA.fontSans, fontSize: 40, fontWeight: 700, color: CINEMA.text }}>
          {label}
        </div>
        <div style={{ fontFamily: CINEMA.fontMono, fontSize: 19, color: CINEMA.textDim, marginTop: 6 }}>
          {detail}
        </div>
      </div>
    </div>
  );
};

const EverySurface: React.FC = () => (
  <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 110px", gap: 80 }}>
    <div style={{ width: 700, display: "flex", flexDirection: "column", gap: 40, flexShrink: 0 }}>
      <KickerLine delay={6}>One agent, every surface</KickerLine>
      {SURFACES.map((s, i) => (
        <SurfaceRow key={s.label} {...s} delay={26 + i * 16} />
      ))}
    </div>
    <div style={{ flex: 1 }}>
      <AppWindow
        src="marketing/desktop-web-research-cite.png"
        delay={20}
        width="100%"
        maxTiltDeg={4}
        sweepAt={90}
      />
    </div>
  </AbsoluteFill>
);

/* ── Beat 5 — integrations wall ──────────────────────────────────────────── */

const CONNECTORS = [
  "Gmail",
  "Outlook",
  "Google Calendar",
  "Xero",
  "Slack",
  "Teams",
  "Notion",
  "Linear",
  "GitHub",
  "Google Sheets",
  "Excel",
  "Drive",
  "OneNote",
  "Planner",
];

const IntegrationsWall: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 52 }}>
      <KickerLine delay={4}>Connects in one click</KickerLine>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 22,
          maxWidth: 1280,
        }}
      >
        {CONNECTORS.map((name, i) => {
          const p = spring({
            frame: frame - 18 - i * 5,
            fps,
            config: { damping: 24, stiffness: 240, mass: 0.65 },
          });
          return (
            <span
              key={name}
              style={{
                padding: "18px 34px",
                borderRadius: 14,
                border: `1px solid ${CINEMA.panelBorder}`,
                background: CINEMA.panel,
                fontFamily: CINEMA.fontSans,
                fontSize: 30,
                fontWeight: 600,
                color: CINEMA.text,
                opacity: Math.min(p, 1),
                transform: `translateY(${(1 - p) * 40}px) scale(${interpolate(p, [0, 1], [0.8, 1])})`,
                boxShadow: `0 18px 60px rgba(0,0,0,0.5)`,
              }}
            >
              {name}
            </span>
          );
        })}
      </div>
      <SubCopy delay={110} align="center" size={26}>
        …and any OpenAPI spec or MCP server you point it at.
      </SubCopy>
    </AbsoluteFill>
  );
};

/* ── Beat 6 — CTA ────────────────────────────────────────────────────────── */

const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = 0.5 + Math.sin(frame / 24) * 0.18;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 }}>
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${CINEMA.emerald}99 0%, ${CINEMA.emerald}33 30%, transparent 65%)`,
          opacity: 0.1 * glow,
        }}
      />
      <WordsReveal text="Liminal" delay={6} size={150} weight={800} align="center" accentWords={[0]} />
      <SubCopy delay={36} align="center" size={34} maxWidth={900}>
        Free to use. Readable source. Windows, macOS & Linux.
      </SubCopy>
      <div style={{ display: "flex", gap: 22, marginTop: 12 }}>
        <MonoPill delay={66} filled>
          vireondynamics.com/liminal
        </MonoPill>
        <MonoPill delay={78} color={CINEMA.cyan}>
          docs.vireondynamics.com
        </MonoPill>
      </div>
    </AbsoluteFill>
  );
};

/* ── Assembly ────────────────────────────────────────────────────────────── */

export const DesktopCinematic: React.FC = () => {
  let cursor = 0;
  const beats: Array<{ comp: React.ReactNode; dur: number; zoom?: number }> = [
    { comp: <ColdOpen />, dur: B1, zoom: 1.06 },
    { comp: <HeroWindow />, dur: B2 },
    { comp: <SessionTrace />, dur: B3, zoom: 1.025 },
    { comp: <EverySurface />, dur: B4 },
    { comp: <IntegrationsWall />, dur: B5, zoom: 1.05 },
    { comp: <CTA />, dur: B6, zoom: 1.04 },
  ];

  return (
    <AbsoluteFill style={{ background: CINEMA.bg }}>
      <CinematicBackdrop />
      {beats.map(({ comp, dur, zoom }, i) => {
        const from = cursor;
        cursor += dur;
        return (
          <Beat key={i} from={from} duration={dur} zoom={zoom}>
            {comp}
          </Beat>
        );
      })}
    </AbsoluteFill>
  );
};
