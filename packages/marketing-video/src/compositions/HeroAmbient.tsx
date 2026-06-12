import React from "react";
import { AbsoluteFill } from "remotion";
import { AppWindow } from "../cinematic/AppWindow";
import { CinematicBackdrop } from "../cinematic/CinematicBackdrop";
import { CINEMA, CINEMA_VIDEO } from "../cinematic/cinema";

/**
 * 12-second seamless ambient loop for the website hero section background:
 * aurora drift + the desktop app floating gently. Every motion completes
 * integer sine cycles, so the last frame matches the first exactly.
 * No text — copy lives in the page, not the video.
 */
export const HERO_AMBIENT_DURATION = 12 * CINEMA_VIDEO.fps;

export const HeroAmbient: React.FC = () => (
  <AbsoluteFill style={{ background: CINEMA.bg }}>
    <CinematicBackdrop loop grainOpacity={0.04} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "70px 0" }}>
      <AppWindow
        src="marketing/desktop-code-ship-test.png"
        delay={-120}
        width="72%"
        maxTiltDeg={2.4}
        floatPx={12}
        sweepAt={200}
        loop
      />
    </AbsoluteFill>
    {/* bottom fade so the page content sits cleanly over the video edge */}
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, transparent 72%, ${CINEMA.bgDeep} 100%)`,
        pointerEvents: "none",
      }}
    />
  </AbsoluteFill>
);
