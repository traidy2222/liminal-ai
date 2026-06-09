import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker, MonoBlock } from "../components/Typography";
import { BRAND, LIMINAL_THEME, VIDEO } from "../theme";
import { type DesktopManifest, loadDesktopManifest } from "../lib/desktopManifest";

export const DESKTOP_HERO_DURATION = 20 * VIDEO.fps;

export const DesktopHeroIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [manifest, setManifest] = useState<DesktopManifest | null>(null);

  useEffect(() => {
    const h = delayRender("desktop-manifest");
    loadDesktopManifest()
      .then(setManifest)
      .finally(() => continueRender(h));
  }, []);

  const heroPng =
    manifest?.results.find((r) => r.id === "desktop-code-ship-test")?.png ??
    "marketing/live-coding-debounce.png";

  const logoScale = spring({ frame, fps, config: { damping: 200, stiffness: 60 } });
  const uiReveal = spring({ frame: frame - 45, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 25, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          <Kicker delay={0}>Vireon Dynamics · Desktop app</Kicker>
          <div style={{ marginTop: 24, transform: `scale(${logoScale})` }}>
            <Headline size={96} delay={6} accent={LIMINAL_THEME.accent}>
              {BRAND.name}
            </Headline>
          </div>
          <BodyCopy delay={20} maxWidth={820}>
            The same harness you run locally — native desktop shell, Hub, integrations,
            and every tool call on screen. Not a mock UI. Real session logs.
          </BodyCopy>
          <MonoBlock
            delay={32}
            lines={[
              "Download from vireondynamics.com/liminal",
              "npm run desktop:build:windows  # from source",
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
            <Img src={staticFile(heroPng)} style={{ width: "100%", display: "block" }} />
          </div>
        </Sequence>

        <div
          style={{
            display: "flex",
            gap: 48,
            fontFamily: LIMINAL_THEME.fontMono,
            fontSize: 14,
            color: LIMINAL_THEME.textDim,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span>Desktop-first</span>
          <span>Real harness</span>
          <span>Your API keys</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
