import React from "react";
import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CINEMA, loopSin } from "./cinema";

/**
 * App screenshot in a floating 3D window: spring entrance (rise + de-blur +
 * scale), continuous gentle tilt/bob, ambient emerald glow, and a specular
 * light sweep across the glass.
 *
 * With `loop`, the float/tilt complete integer cycles over the composition.
 */
export const AppWindow: React.FC<{
  src: string;
  delay?: number;
  width?: number | string;
  maxTiltDeg?: number;
  floatPx?: number;
  sweepAt?: number;
  loop?: boolean;
  align?: "center" | "flex-start" | "flex-end";
}> = ({
  src,
  delay = 0,
  width = "86%",
  maxTiltDeg = 3.2,
  floatPx = 10,
  sweepAt = 50,
  loop = false,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 40, stiffness: 80, mass: 1.1 },
  });
  const wave = (cycles: number, phase: number) =>
    loop
      ? loopSin(frame, durationInFrames, cycles, phase)
      : Math.sin(frame / (160 / cycles) + phase);

  const rotX = wave(1, 0) * maxTiltDeg * 0.6;
  const rotY = wave(1, Math.PI / 2) * maxTiltDeg;
  const bob = wave(2, Math.PI / 4) * floatPx;

  const sweep = interpolate(frame - delay - sweepAt, [0, 110], [-65, 165], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ perspective: 1700, display: "flex", justifyContent: align, width: "100%" }}>
      <div
        style={{
          position: "relative",
          width,
          borderRadius: 18,
          overflow: "hidden",
          border: `1px solid ${CINEMA.panelBorder}`,
          opacity: enter,
          filter: `blur(${(1 - enter) * 10}px)`,
          transform: [
            `translateY(${(1 - enter) * 90 + bob}px)`,
            `scale(${interpolate(enter, [0, 1], [0.93, 1])})`,
            `rotateX(${rotX}deg)`,
            `rotateY(${rotY}deg)`,
          ].join(" "),
          transformStyle: "preserve-3d",
          boxShadow: [
            "0 60px 140px rgba(0,0,0,0.72)",
            `0 0 110px ${CINEMA.emerald}1f`,
            `inset 0 1px 0 rgba(255,255,255,0.08)`,
          ].join(", "),
          background: CINEMA.panel,
        }}
      >
        <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />

        {/* specular sweep */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.09) 49%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.09) 51%, transparent 62%)`,
            transform: `translateX(${sweep}%)`,
            pointerEvents: "none",
          }}
        />
        {/* glass top highlight */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 14%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};
