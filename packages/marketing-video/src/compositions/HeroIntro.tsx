import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker, MonoBlock } from "../components/Typography";
import { BRAND, LIMINAL_THEME, VIDEO } from "../theme";

export const HERO_INTRO_DURATION = 20 * VIDEO.fps;

export const HeroIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 60 },
  });

  const uiReveal = spring({
    frame: frame - 45,
    fps,
    config: { damping: 200 },
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <GridBackground />
      <ScanlineOverlay />

      <AbsoluteFill
        style={{
          padding: "80px 100px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Kicker delay={0}>Vireon Dynamics presents</Kicker>
          <div style={{ marginTop: 24, transform: `scale(${logoScale})` }}>
            <Headline size={96} delay={6} accent={LIMINAL_THEME.accent}>
              {BRAND.name}
            </Headline>
          </div>
          <BodyCopy delay={20} maxWidth={820}>
            {BRAND.tagline}. Model-agnostic. Runs on your machine. Every tool
            call visible — not a black-box chat tab.
          </BodyCopy>
          <MonoBlock
            delay={32}
            lines={[
              "curl -fsSL https://www.vireondynamics.com/install/install.sh | bash",
              "liminal web --bootstrap --open",
            ]}
          />
        </div>

        <Sequence from={45} layout="none">
          <div
            style={{
              alignSelf: "center",
              width: "88%",
              borderRadius: 16,
              overflow: "hidden",
              border: `1px solid ${LIMINAL_THEME.border}`,
              opacity: uiReveal,
              transform: `translateY(${(1 - uiReveal) * 60}px) scale(${interpolate(uiReveal, [0, 1], [0.96, 1])})`,
              boxShadow:
                "0 40px 120px rgba(0,0,0,0.65), 0 0 80px rgba(0,212,255,0.15)",
            }}
          >
            <Img
              src={staticFile("web-ui.png")}
              style={{ width: "100%", display: "block" }}
            />
          </div>
        </Sequence>

        <div
          style={{
            display: "flex",
            gap: 48,
            fontFamily: LIMINAL_THEME.fontMono,
            fontSize: 14,
            color: LIMINAL_THEME.textDim,
            letterSpacing: "0.06em",
          }}
        >
          {["OpenRouter-ready", "TUI + Web", "FSL Community Edition"].map(
            (t, i) => {
              const p = spring({ frame: frame - 55 - i * 5, fps });
              return (
                <span key={t} style={{ opacity: p, color: LIMINAL_THEME.accent }}>
                  ◇ {t}
                </span>
              );
            },
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
