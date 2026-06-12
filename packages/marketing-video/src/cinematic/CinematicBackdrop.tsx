import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CINEMA, GRAIN_URI, loopSin } from "./cinema";

type BlobSpec = {
  color: string;
  size: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  cycles: number;
  phase: number;
  opacity: number;
};

const BLOBS: BlobSpec[] = [
  {
    color: CINEMA.emerald,
    size: 1100,
    x: 18,
    y: 8,
    driftX: 90,
    driftY: 60,
    cycles: 1,
    phase: 0,
    opacity: 0.13,
  },
  {
    color: CINEMA.cyan,
    size: 900,
    x: 78,
    y: 70,
    driftX: 70,
    driftY: 90,
    cycles: 1,
    phase: Math.PI / 2,
    opacity: 0.1,
  },
  {
    color: CINEMA.violet,
    size: 760,
    x: 55,
    y: 30,
    driftX: 110,
    driftY: 50,
    cycles: 2,
    phase: Math.PI,
    opacity: 0.07,
  },
];

/**
 * Aurora backdrop: drifting blurred color fields over a near-black base,
 * a faint perspective grid, film grain, and a heavy vignette.
 *
 * With `loop`, every motion completes integer cycles over the composition
 * duration so the first and last frames match (seamless website loops).
 */
export const CinematicBackdrop: React.FC<{
  loop?: boolean;
  gridOpacity?: number;
  grainOpacity?: number;
}> = ({ loop = false, gridOpacity = 0.5, grainOpacity = 0.05 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const wave = (cycles: number, phase: number) =>
    loop
      ? loopSin(frame, durationInFrames, cycles, phase)
      : Math.sin(frame / (140 / cycles) + phase);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 130% 90% at 50% -10%, #04130b 0%, ${CINEMA.bg} 48%, ${CINEMA.bgDeep} 100%)` }}>
      {BLOBS.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `calc(${b.x}% - ${b.size / 2}px)`,
            top: `calc(${b.y}% - ${b.size / 2}px)`,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            // Soft-stop radial gradient instead of filter:blur — visually identical
            // aurora, but ~free to composite (blur(90px) on 1100px layers caused
            // delayRender timeouts at render time).
            background: `radial-gradient(circle, ${b.color}cc 0%, ${b.color}55 28%, transparent 68%)`,
            opacity: b.opacity,
            transform: `translate(${wave(b.cycles, b.phase) * b.driftX}px, ${
              wave(b.cycles, b.phase + Math.PI / 3) * b.driftY
            }px)`,
          }}
        />
      ))}

      <AbsoluteFill
        style={{
          backgroundImage: `
            linear-gradient(rgba(43,217,124,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(43,217,124,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "72px 72px",
          opacity: gridOpacity,
          maskImage:
            "radial-gradient(ellipse 90% 80% at 50% 45%, black 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 80% at 50% 45%, black 30%, transparent 78%)",
        }}
      />

      <AbsoluteFill
        style={{
          backgroundImage: GRAIN_URI,
          backgroundSize: "240px 240px",
          backgroundPosition: `${(frame * 7) % 240}px ${(frame * 13) % 240}px`,
          opacity: grainOpacity,
          mixBlendMode: "overlay",
        }}
      />

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 95% 85% at 50% 48%, transparent 42%, rgba(0,0,0,0.62) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
