import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CINEMA, easeOutExpo } from "./cinema";

/**
 * Headline that reveals word-by-word: each word rises, de-blurs, and settles
 * on an offset spring. `accentWords` (0-based indices) render in emerald.
 */
export const WordsReveal: React.FC<{
  text: string;
  delay?: number;
  size?: number;
  weight?: number;
  perWord?: number;
  accentWords?: number[];
  maxWidth?: number;
  align?: "left" | "center";
}> = ({
  text,
  delay = 0,
  size = 88,
  weight = 750,
  perWord = 5,
  accentWords = [],
  maxWidth,
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <h1
      style={{
        margin: 0,
        maxWidth,
        fontFamily: CINEMA.fontSans,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.06,
        letterSpacing: "-0.025em",
        color: CINEMA.text,
        textAlign: align,
        textWrap: "balance" as never,
      }}
    >
      {words.map((word, i) => {
        const p = spring({
          frame: frame - delay - i * perWord,
          fps,
          config: { damping: 34, stiffness: 160, mass: 0.9 },
        });
        const blur = interpolate(p, [0, 1], [14, 0]);
        const accent = accentWords.includes(i);
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              opacity: p,
              filter: `blur(${blur}px)`,
              transform: `translateY(${(1 - p) * 42}px)`,
              color: accent ? CINEMA.emeraldBright : undefined,
              textShadow: accent ? `0 0 56px ${CINEMA.emerald}66` : undefined,
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </h1>
  );
};

/** Mono uppercase kicker whose letter-spacing tightens as it fades in. */
export const KickerLine: React.FC<{
  children: React.ReactNode;
  delay?: number;
  color?: string;
}> = ({ children, delay = 0, color = CINEMA.emerald }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          width: 44 * p,
          height: 2,
          background: `linear-gradient(90deg, ${color}, transparent)`,
          borderRadius: 2,
        }}
      />
      <span
        style={{
          fontFamily: CINEMA.fontMono,
          fontSize: 17,
          textTransform: "uppercase",
          color,
          opacity: p,
          letterSpacing: `${interpolate(p, [0, 1], [0.62, 0.3])}em`,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </div>
  );
};

/** Supporting copy with a soft rise. */
export const SubCopy: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  maxWidth?: number;
  align?: "left" | "center";
}> = ({ children, delay = 0, size = 30, maxWidth = 780, align = "left" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 38, stiffness: 110 } });
  return (
    <p
      style={{
        margin: 0,
        maxWidth,
        fontFamily: CINEMA.fontSans,
        fontSize: size,
        fontWeight: 400,
        lineHeight: 1.5,
        color: CINEMA.textMuted,
        textAlign: align,
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px)`,
      }}
    >
      {children}
    </p>
  );
};

/** Gradient underline that sweeps out beneath a headline. */
export const UnderlineSweep: React.FC<{
  delay?: number;
  width?: number;
}> = ({ delay = 0, width = 460 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  });
  return (
    <div
      style={{
        height: 4,
        width,
        borderRadius: 4,
        transform: `scaleX(${p})`,
        transformOrigin: "left center",
        background: `linear-gradient(90deg, ${CINEMA.emerald}, ${CINEMA.cyan} 70%, transparent)`,
        boxShadow: `0 0 32px ${CINEMA.emerald}55`,
      }}
    />
  );
};

/** Small mono pill — platform tags, URL chips. */
export const MonoPill: React.FC<{
  children: React.ReactNode;
  delay?: number;
  color?: string;
  filled?: boolean;
}> = ({ children, delay = 0, color = CINEMA.emerald, filled = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 26, stiffness: 220, mass: 0.7 } });
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "14px 30px",
        borderRadius: 999,
        border: `1px solid ${filled ? "transparent" : `${color}55`}`,
        background: filled ? color : `${color}14`,
        color: filled ? "#02180c" : color,
        fontFamily: CINEMA.fontMono,
        fontSize: 22,
        fontWeight: filled ? 700 : 500,
        letterSpacing: "0.04em",
        opacity: Math.min(p, 1),
        transform: `scale(${interpolate(p, [0, 1], [0.85, 1])})`,
        boxShadow: filled ? `0 8px 48px ${color}66` : "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};
