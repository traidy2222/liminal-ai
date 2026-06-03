import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { FeatureCard, type FeatureSlide } from "../components/FeatureCard";
import { Kicker } from "../components/Typography";
import { VIDEO } from "../theme";

const SLIDE_FRAMES = 105;

const SLIDES: FeatureSlide[] = [
  {
    image: "marketing/coding-typescript.png",
    title: "Ship code with verification",
    subtitle:
      "Write, edit, run tests and typecheck — with optional self-heal lint after edits.",
    accent: "#00ff88",
  },
  {
    image: "marketing/memory-recall.png",
    title: "Memory that recalls on intent",
    subtitle:
      "Hybrid BM25 + vector search across typed notes — workspace and global scope.",
    accent: "#ff4488",
  },
  {
    image: "marketing/web-research.png",
    title: "Research on the open web",
    subtitle:
      "web_search plus parallel web_fetch with readability extraction — cite sources in answers.",
    accent: "#00d4ff",
  },
  {
    image: "marketing/subagents.png",
    title: "Sub-agents & workflows",
    subtitle:
      "Fan out parallel agents or run declarative multi-phase workflows — detail stays out of context.",
    accent: "#ffb347",
  },
  {
    image: "marketing/approval-gate.png",
    title: "Approval gates by default",
    subtitle:
      "Destructive shell and writes can pause for human authorize — safety judge optional.",
    accent: "#ff2244",
  },
  {
    image: "marketing/persona-bootstrap.png",
    title: "Persona + themed shell",
    subtitle:
      "Describe how the assistant should sound — Liminal generates tone and web UI chrome.",
    accent: "#cc88ff",
  },
];

export const FEATURE_TOUR_DURATION = SLIDES.length * SLIDE_FRAMES + 30;

/** Single slide — used inside Series in MasterPromo and standalone composition. */
export const FeatureTourSlide: React.FC<{ index: number }> = ({ index }) => {
  const slide = SLIDES[index];
  if (!slide) return null;

  return (
    <AbsoluteFill style={{ padding: "72px 96px" }}>
      <GridBackground />
      <Kicker delay={0}>In the box</Kicker>
      <div style={{ flex: 1, display: "flex", marginTop: 32, height: "calc(100% - 80px)" }}>
        <FeatureCard slide={slide} enterFrame={0} />
      </div>
    </AbsoluteFill>
  );
};

export const FeatureTourFull: React.FC = () => (
  <AbsoluteFill>
    {SLIDES.map((_, i) => (
      <Sequence key={i} from={i * SLIDE_FRAMES} durationInFrames={SLIDE_FRAMES}>
        <FeatureTourSlide index={i} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

export { SLIDES, SLIDE_FRAMES };
