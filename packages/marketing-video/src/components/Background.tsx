import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { LIMINAL_THEME } from "../theme";

export const GridBackground: React.FC<{
  pulse?: boolean;
  vignette?: number;
}> = ({ pulse = true, vignette = 0.55 }) => {
  const frame = useCurrentFrame();
  const drift = pulse ? Math.sin(frame / 90) * 0.015 : 0;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 120% 80% at 50% 0%, #0c1828 0%, ${LIMINAL_THEME.bg} 55%)`,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: `
            linear-gradient(${LIMINAL_THEME.gridLine} 1px, transparent 1px),
            linear-gradient(90deg, ${LIMINAL_THEME.gridLine} 1px, transparent 1px)
          `,
          backgroundSize: `${64 + drift * 200}px ${64 + drift * 200}px`,
          opacity: 0.9,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,${vignette}) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, transparent 0%, rgba(0,212,255,0.04) 50%, transparent 100%)`,
          transform: `translateY(${interpolate(frame % 240, [0, 240], [0, -120])}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

export const ScanlineOverlay: React.FC<{ opacity?: number }> = ({
  opacity = 0.04,
}) => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)",
      opacity,
      pointerEvents: "none",
    }}
  />
);
