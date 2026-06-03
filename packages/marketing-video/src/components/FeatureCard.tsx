import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { LIMINAL_THEME } from "../theme";

export type FeatureSlide = {
  image: string;
  title: string;
  subtitle: string;
  accent?: string;
};

export const FeatureCard: React.FC<{
  slide: FeatureSlide;
  enterFrame?: number;
}> = ({ slide, enterFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = Math.max(0, frame - enterFrame);

  const enter = spring({
    frame: local,
    fps,
    config: { damping: 200, stiffness: 80 },
  });

  const kenBurns = interpolate(local, [0, 150], [1.04, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        gap: 48,
        alignItems: "center",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <div
        style={{
          flex: 1.15,
          borderRadius: 14,
          overflow: "hidden",
          border: `1px solid ${LIMINAL_THEME.border}`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.55), 0 0 60px rgba(0,212,255,0.12)",
          transform: `scale(${kenBurns})`,
        }}
      >
        <Img
          src={staticFile(slide.image)}
          style={{ width: "100%", display: "block" }}
        />
      </div>
      <div style={{ flex: 0.85, paddingRight: 24 }}>
        <div
          style={{
            fontFamily: LIMINAL_THEME.fontMono,
            fontSize: 13,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: slide.accent ?? LIMINAL_THEME.accent,
            marginBottom: 16,
          }}
        >
          Capability
        </div>
        <h2
          style={{
            margin: 0,
            fontFamily: LIMINAL_THEME.fontSans,
            fontSize: 48,
            fontWeight: 700,
            color: LIMINAL_THEME.text,
            lineHeight: 1.1,
          }}
        >
          {slide.title}
        </h2>
        <p
          style={{
            marginTop: 18,
            fontSize: 24,
            lineHeight: 1.45,
            color: LIMINAL_THEME.textMuted,
            fontFamily: LIMINAL_THEME.fontSans,
          }}
        >
          {slide.subtitle}
        </p>
      </div>
    </div>
  );
};
