import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CINEMA } from "./cinema";

export type TraceStep =
  | { kind: "prompt"; text: string; at: number }
  | {
      kind: "tool";
      name: string;
      detail: string;
      at: number;
      settleAt: number;
      color?: string;
    }
  | { kind: "assistant"; text: string; at: number }
  | { kind: "result"; label: string; at: number };

/**
 * Native re-render of a Liminal session trace, styled after the desktop app:
 * typed prompt, tool cards that pop in and tick to ✓, assistant line, and a
 * final result badge. Fully scripted — crisp at any resolution.
 */
export const TraceCascade: React.FC<{ steps: TraceStep[]; width?: number }> = ({
  steps,
  width = 1280,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        fontFamily: CINEMA.fontMono,
      }}
    >
      {steps.map((step, i) => {
        const p = spring({
          frame: frame - step.at,
          fps,
          config: { damping: 30, stiffness: 170, mass: 0.8 },
        });
        if (frame < step.at - 5) return <div key={i} />;

        const base: React.CSSProperties = {
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`,
        };

        if (step.kind === "prompt") {
          const chars = Math.max(
            0,
            Math.min(step.text.length, Math.floor((frame - step.at) / 1.1))
          );
          const done = chars >= step.text.length;
          return (
            <div
              key={i}
              style={{
                ...base,
                display: "flex",
                gap: 16,
                alignItems: "baseline",
                padding: "20px 26px",
                borderRadius: 14,
                background: "rgba(43,217,124,0.07)",
                border: `1px solid ${CINEMA.panelBorder}`,
                fontSize: 24,
                color: CINEMA.text,
              }}
            >
              <span style={{ color: CINEMA.emerald, fontWeight: 700 }}>›</span>
              <span>
                {step.text.slice(0, chars)}
                {!done && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 26,
                      marginLeft: 2,
                      verticalAlign: "text-bottom",
                      background: CINEMA.emerald,
                      opacity: Math.floor(frame / 16) % 2 === 0 ? 1 : 0.2,
                    }}
                  />
                )}
              </span>
            </div>
          );
        }

        if (step.kind === "tool") {
          const settled = frame >= step.settleAt;
          const spinnerChar = ["◐", "◓", "◑", "◒"][Math.floor(frame / 8) % 4];
          const color = step.color ?? CINEMA.emerald;
          const tickPop = spring({
            frame: frame - step.settleAt,
            fps,
            config: { damping: 18, stiffness: 320, mass: 0.6 },
          });
          return (
            <div
              key={i}
              style={{
                ...base,
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "18px 26px",
                marginLeft: 44,
                borderRadius: 14,
                background: CINEMA.panel,
                border: `1px solid ${settled ? `${color}44` : "rgba(255,255,255,0.09)"}`,
                boxShadow: settled ? `0 0 44px ${color}14` : "none",
                fontSize: 22,
              }}
            >
              <span
                style={{
                  width: 30,
                  textAlign: "center",
                  color: settled ? color : CINEMA.textDim,
                  fontSize: 24,
                  fontWeight: 700,
                  transform: settled ? `scale(${interpolate(tickPop, [0, 1], [0.4, 1])})` : undefined,
                  display: "inline-block",
                }}
              >
                {settled ? "✓" : spinnerChar}
              </span>
              <span style={{ color: CINEMA.text, fontWeight: 600 }}>{step.name}</span>
              <span
                style={{
                  color: CINEMA.textDim,
                  fontSize: 19,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {step.detail}
              </span>
              <span
                style={{
                  fontSize: 15,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: settled ? color : CINEMA.textDim,
                }}
              >
                {settled ? "ok" : "running"}
              </span>
            </div>
          );
        }

        if (step.kind === "assistant") {
          return (
            <div
              key={i}
              style={{
                ...base,
                padding: "6px 26px 6px 44px",
                fontFamily: CINEMA.fontSans,
                fontSize: 24,
                lineHeight: 1.5,
                color: CINEMA.textMuted,
              }}
            >
              {step.text}
            </div>
          );
        }

        // result badge
        return (
          <div key={i} style={{ ...base, display: "flex", marginLeft: 44 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 30px",
                borderRadius: 999,
                background: `${CINEMA.emerald}1a`,
                border: `1px solid ${CINEMA.emerald}66`,
                color: CINEMA.emeraldBright,
                fontSize: 23,
                fontWeight: 700,
                boxShadow: `0 0 60px ${CINEMA.emerald}33`,
              }}
            >
              <span style={{ fontSize: 26 }}>✓</span>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
