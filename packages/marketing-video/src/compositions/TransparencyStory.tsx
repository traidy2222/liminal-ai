import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker } from "../components/Typography";
import { LIMINAL_THEME, VIDEO } from "../theme";

export const TRANSPARENCY_STORY_DURATION = 24 * VIDEO.fps;

const CHAT_WRAPPER = [
  { role: "user", text: "Refactor the auth module and run tests." },
  { role: "assistant", text: "Done! ✓ Everything should work now." },
];

const HARNESS_TRACE = [
  { tool: "read_file", detail: "packages/core/src/agent.ts" },
  { tool: "edit_file", detail: "auth/session.ts — 3 replacements" },
  { tool: "run_tests", detail: "npm run test -w @liminal/core" },
  { tool: "run_lint", detail: "tsc --noEmit (changed files)" },
];

export const TransparencyStory: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const split = spring({ frame: frame - 20, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill>
      <GridBackground vignette={0.65} />
      <ScanlineOverlay />

      <AbsoluteFill style={{ padding: "64px 88px" }}>
        <Kicker>Why not another chat tab?</Kicker>
        <Headline size={56} delay={6}>
          See every step — not just the summary
        </Headline>
        <BodyCopy delay={14} maxWidth={900}>
          Thin wrappers hide tool failures and hallucinate progress. Liminal
          streams tool cards, harness traces, and approval modals in TUI and web.
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
          {/* Black box */}
          <Panel title="Typical chat UI" accent={LIMINAL_THEME.textDim}>
            {CHAT_WRAPPER.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                text={m.text}
                muted
                delay={30 + i * 12}
              />
            ))}
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
              ??? tools · ??? files · ??? errors
            </div>
          </Panel>

          {/* Liminal */}
          <Panel title="Liminal harness" accent={LIMINAL_THEME.accent}>
            {HARNESS_TRACE.map((row, i) => (
              <ToolRow key={row.tool} row={row} delay={35 + i * 8} />
            ))}
            <Bubble
              role="assistant"
              text="Tests green. Session log → .agent_sessions/"
              delay={70}
            />
          </Panel>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Panel: React.FC<{
  title: string;
  accent: string;
  children: React.ReactNode;
}> = ({ title, accent, children }) => (
  <div
    style={{
      flex: 1,
      borderRadius: 14,
      border: `1px solid ${accent}44`,
      background: LIMINAL_THEME.bgElevated,
      padding: 28,
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    }}
  >
    <div
      style={{
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 12,
        letterSpacing: "0.15em",
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

const Bubble: React.FC<{
  role: string;
  text: string;
  delay: number;
  muted?: boolean;
}> = ({ role, text, delay, muted }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps });

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "14px 18px",
        borderRadius: 10,
        background: muted ? "#0a0c10" : "#061018",
        border: `1px solid ${muted ? "#222" : LIMINAL_THEME.border}`,
        opacity: p,
        fontFamily: LIMINAL_THEME.fontSans,
        fontSize: 17,
        color: muted ? LIMINAL_THEME.textDim : LIMINAL_THEME.text,
      }}
    >
      <span style={{ color: LIMINAL_THEME.accent, fontSize: 11, fontFamily: LIMINAL_THEME.fontMono }}>
        {role}
      </span>
      <div style={{ marginTop: 6 }}>{text}</div>
    </div>
  );
};

const ToolRow: React.FC<{
  row: { tool: string; detail: string };
  delay: number;
}> = ({ row, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps });

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        marginBottom: 12,
        opacity: p,
        transform: `translateX(${(1 - p) * -16}px)`,
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 15,
      }}
    >
      <span style={{ color: LIMINAL_THEME.success }}>▸ {row.tool}</span>
      <span style={{ color: LIMINAL_THEME.textMuted }}>{row.detail}</span>
    </div>
  );
};
