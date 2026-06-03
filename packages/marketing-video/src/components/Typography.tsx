import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { LIMINAL_THEME } from "../theme";

export const Kicker: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 120 },
  });

  return (
    <div
      style={{
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 14,
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: LIMINAL_THEME.accent,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 12}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const Headline: React.FC<{
  children: React.ReactNode;
  size?: number;
  delay?: number;
  accent?: string;
}> = ({ children, size = 72, delay = 8, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 180, stiffness: 90 },
  });

  return (
    <h1
      style={{
        margin: 0,
        fontFamily: LIMINAL_THEME.fontSans,
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.08,
        color: accent ?? LIMINAL_THEME.text,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 28}px)`,
        textShadow: accent
          ? `0 0 40px ${accent}44`
          : "0 0 60px rgba(0,212,255,0.15)",
      }}
    >
      {children}
    </h1>
  );
};

export const BodyCopy: React.FC<{
  children: React.ReactNode;
  delay?: number;
  maxWidth?: number;
}> = ({ children, delay = 18, maxWidth = 720 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
  });

  return (
    <p
      style={{
        margin: "20px 0 0",
        maxWidth,
        fontFamily: LIMINAL_THEME.fontSans,
        fontSize: 26,
        lineHeight: 1.45,
        color: LIMINAL_THEME.textMuted,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 16}px)`,
      }}
    >
      {children}
    </p>
  );
};

export const MonoBlock: React.FC<{
  lines: string[];
  delay?: number;
}> = ({ lines, delay = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        marginTop: 28,
        padding: "20px 24px",
        borderRadius: 10,
        border: `1px solid ${LIMINAL_THEME.border}`,
        background: LIMINAL_THEME.bgPanel,
        fontFamily: LIMINAL_THEME.fontMono,
        fontSize: 18,
        lineHeight: 1.55,
        color: LIMINAL_THEME.accent,
        boxShadow: "0 0 40px rgba(0,212,255,0.08)",
      }}
    >
      {lines.map((line, i) => {
        const p = spring({
          frame: frame - delay - i * 4,
          fps,
          config: { damping: 200 },
        });
        return (
          <div
            key={line}
            style={{
              opacity: p,
              transform: `translateX(${(1 - p) * -12}px)`,
            }}
          >
            <span style={{ color: LIMINAL_THEME.textDim }}>$ </span>
            {line}
          </div>
        );
      })}
    </div>
  );
};
