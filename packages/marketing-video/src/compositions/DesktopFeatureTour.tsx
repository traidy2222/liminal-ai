import React, { useEffect, useState } from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender } from "remotion";
import { GridBackground } from "../components/Background";
import { FeatureCard, type FeatureSlide } from "../components/FeatureCard";
import { Kicker } from "../components/Typography";
import { VIDEO } from "../theme";
import { type DesktopManifest, loadDesktopManifest } from "../lib/desktopManifest";

export const DESKTOP_SLIDE_FRAMES = 105;

export const DesktopFeatureTourFull: React.FC = () => {
  const [slides, setSlides] = useState<FeatureSlide[]>([]);

  useEffect(() => {
    const h = delayRender("desktop-feature-slides");
    loadDesktopManifest()
      .then((m) => {
        const next: FeatureSlide[] = m.results
          .filter((r) => r.png && r.title)
          .map((r) => ({
            image: r.png!,
            title: r.title!,
            subtitle: r.subtitle ?? "",
            accent: r.accent,
          }));
        setSlides(next);
      })
      .finally(() => continueRender(h));
  }, []);

  if (!slides.length) return null;

  return (
    <AbsoluteFill>
      {slides.map((slide, i) => (
        <Sequence key={slide.image} from={i * DESKTOP_SLIDE_FRAMES} durationInFrames={DESKTOP_SLIDE_FRAMES}>
          <AbsoluteFill style={{ padding: "72px 96px" }}>
            <GridBackground />
            <Kicker delay={0}>Desktop app · real captures</Kicker>
            <div style={{ flex: 1, display: "flex", marginTop: 32, height: "calc(100% - 80px)" }}>
              <FeatureCard slide={slide} enterFrame={0} />
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export function desktopFeatureTourDuration(slideCount = 4) {
  return slideCount * DESKTOP_SLIDE_FRAMES + 30;
}

export const DESKTOP_FEATURE_TOUR_DURATION = desktopFeatureTourDuration(4);
