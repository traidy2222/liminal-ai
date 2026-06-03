import React from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { ReActDiagram } from "../components/ReActDiagram";
import { BodyCopy, Headline, Kicker } from "../components/Typography";
import { LIMINAL_THEME, VIDEO } from "../theme";

const PHASE_FRAMES = 90;

export const HARNESS_EXPLAINER_DURATION = 38 * VIDEO.fps;

const PHASES = [
  {
    title: "A harness, not a chat wrapper",
    body: "Liminal orchestrates a full ReAct loop: retries, approvals, context tiers, and tool dispatch — built to finish multi-step work.",
    highlight: 0,
  },
  {
    title: "You stay in control",
    body: "Destructive tools can require explicit approval. YOLO mode exists for trusted sandboxes only.",
    highlight: 1,
  },
  {
    title: "Real tools on your repo",
    body: "Files, shell, git, AST search, tests, lint, browser, and web — lazy-loaded tool families keep context lean.",
    highlight: 2,
  },
  {
    title: "Knowledge that compounds",
    body: "Hybrid BM25 + embedding recall, Obsidian vault integration, and workspace-scoped memory across chats.",
    highlight: 3,
  },
  {
    title: "Context that survives long tasks",
    body: "Hot/warm round tiers, output distillation, artifact pointers — the loop keeps going without drowning in tokens.",
    highlight: 4,
  },
];

export const HarnessExplainer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = Math.min(
    PHASES.length - 1,
    Math.floor(frame / PHASE_FRAMES),
  );
  const phase = PHASES[phaseIndex];
  const local = frame % PHASE_FRAMES;

  const textIn = spring({
    frame: local,
    fps,
    config: { damping: 200 },
  });

  return (
    <AbsoluteFill>
      <GridBackground pulse={false} />
      <ScanlineOverlay />

      <AbsoluteFill
        style={{
          padding: "72px 96px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Kicker delay={0}>Architecture</Kicker>
        <div
          style={{
            opacity: textIn,
            transform: `translateY(${(1 - textIn) * 20}px)`,
            flexShrink: 0,
            maxHeight: 280,
            overflow: "hidden",
          }}
        >
          <Headline size={46} delay={4}>
            {phase.title}
          </Headline>
          <BodyCopy delay={10} maxWidth={900}>
            {phase.body}
          </BodyCopy>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 380,
            marginTop: 20,
            position: "relative",
            borderRadius: 16,
            border: `1px solid ${LIMINAL_THEME.border}`,
            background: LIMINAL_THEME.bgPanel,
            overflow: "hidden",
            padding: "8px 12px",
            boxSizing: "border-box",
          }}
        >
          <Sequence from={0} layout="none">
            <ReActDiagram highlightPhase={phase.highlight} />
          </Sequence>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          {PHASES.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === phaseIndex ? 36 : 10,
                height: 6,
                borderRadius: 3,
                background:
                  i === phaseIndex
                    ? LIMINAL_THEME.accent
                    : LIMINAL_THEME.textDim,
                transition: "width 0.2s",
              }}
            />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
