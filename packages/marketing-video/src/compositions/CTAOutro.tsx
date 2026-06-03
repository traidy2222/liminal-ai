import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GridBackground, ScanlineOverlay } from "../components/Background";
import { BodyCopy, Headline, Kicker, MonoBlock } from "../components/Typography";
import { BRAND, LIMINAL_THEME, VIDEO } from "../theme";

export const CTA_OUTRO_DURATION = 14 * VIDEO.fps;

export const CTAOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const pulse = interpolate(
    Math.sin(frame / 15),
    [-1, 1],
    [0.85, 1],
  );

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
        <Kicker delay={0}>Community Edition · FSL-1.1-MIT</Kicker>
        <Headline size={80} delay={8} accent={LIMINAL_THEME.accent}>
          Run {BRAND.name} locally today
        </Headline>
        <BodyCopy delay={18} maxWidth={760}>
          Free on your machine with your API keys. Pro and Team add cloud sync —
          optional, not required to ship.
        </BodyCopy>

        <div style={{ transform: `scale(${pulse})`, width: "100%", maxWidth: 900 }}>
          <MonoBlock
            delay={28}
            lines={[
              "npm run setup && npm run web -- --bootstrap",
              `https://${BRAND.site}`,
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
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          }}
        >
          Built by {BRAND.vendor} · {BRAND.docs}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
