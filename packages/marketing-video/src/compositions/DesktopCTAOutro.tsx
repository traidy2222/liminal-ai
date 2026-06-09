import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker, MonoBlock } from "../components/Typography";
import { BRAND, LIMINAL_THEME, VIDEO } from "../theme";

export const DESKTOP_CTA_DURATION = 14 * VIDEO.fps;

export const DesktopCTAOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const pulse = interpolate(Math.sin(frame / 15), [-1, 1], [0.85, 1]);

  return (
    <AbsoluteFill>
      <GridBackground />
      <ScanlineOverlay />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: 120,
        }}
      >
        <Kicker delay={0}>Desktop app · Community Edition</Kicker>
        <Headline size={80} delay={8} accent={LIMINAL_THEME.accent}>
          Download {BRAND.name} for Windows
        </Headline>
        <BodyCopy delay={18} maxWidth={760}>
          Same harness as CLI and web — native shell, Hub, integrations, and voice.
          Your keys, your machine, full tool transparency.
        </BodyCopy>

        <div style={{ transform: `scale(${pulse})`, width: "100%", maxWidth: 900 }}>
          <MonoBlock
            delay={28}
            lines={[
              `https://${BRAND.site}#download`,
              "liminal desktop  # after install",
            ]}
          />
        </div>

        <div
          style={{
            marginTop: 48,
            fontFamily: LIMINAL_THEME.fontMono,
            fontSize: 16,
            color: LIMINAL_THEME.textDim,
            opacity: interpolate(
              frame,
              [durationInFrames - 40, durationInFrames - 10],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            ),
          }}
        >
          Built by {BRAND.vendor} · {BRAND.docs}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
