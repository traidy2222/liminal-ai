import React from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { DesktopHeroIntro, DESKTOP_HERO_DURATION } from "./DesktopHeroIntro";
import { HarnessExplainer, HARNESS_EXPLAINER_DURATION } from "./HarnessExplainer";
import {
  DesktopFeatureTourFull,
  DESKTOP_FEATURE_TOUR_DURATION,
} from "./DesktopFeatureTour";
import {
  DesktopTransparencyStory,
  DESKTOP_TRANSPARENCY_DURATION,
} from "./DesktopTransparencyStory";
import { DesktopCTAOutro, DESKTOP_CTA_DURATION } from "./DesktopCTAOutro";
import { VIDEO } from "../theme";

const TRANSITION_FRAMES = 15;

export const DESKTOP_PROMO_DURATION =
  DESKTOP_HERO_DURATION +
  HARNESS_EXPLAINER_DURATION +
  DESKTOP_FEATURE_TOUR_DURATION +
  DESKTOP_TRANSPARENCY_DURATION +
  DESKTOP_CTA_DURATION -
  TRANSITION_FRAMES * 4;

/** Full desktop marketing reel — real capture assets from desktop-manifest.json. */
export const DesktopPromoFull: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#020408" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={DESKTOP_HERO_DURATION}>
        <DesktopHeroIntro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={HARNESS_EXPLAINER_DURATION}>
        <HarnessExplainer />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={DESKTOP_FEATURE_TOUR_DURATION}>
        <DesktopFeatureTourFull />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={DESKTOP_TRANSPARENCY_DURATION}>
        <DesktopTransparencyStory />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={DESKTOP_CTA_DURATION}>
        <DesktopCTAOutro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export const DESKTOP_SOCIAL_TEASER_DURATION =
  12 * VIDEO.fps + 8 * VIDEO.fps + DESKTOP_CTA_DURATION;

/** Short social cut — hero + transparency (real trace) + CTA. */
export const DesktopSocialTeaser: React.FC = () => (
  <AbsoluteFill>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={12 * VIDEO.fps}>
        <DesktopHeroIntro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={8 * VIDEO.fps}>
        <DesktopTransparencyStory />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={DESKTOP_CTA_DURATION}>
        <DesktopCTAOutro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
