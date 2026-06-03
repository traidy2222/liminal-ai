import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { HeroIntro, HERO_INTRO_DURATION } from "./HeroIntro";
import { HarnessExplainer, HARNESS_EXPLAINER_DURATION } from "./HarnessExplainer";
import { FeatureTourFull, FEATURE_TOUR_DURATION } from "./FeatureTour";
import { TransparencyStory, TRANSPARENCY_STORY_DURATION } from "./TransparencyStory";
import { CTAOutro, CTA_OUTRO_DURATION } from "./CTAOutro";
import { VIDEO } from "../theme";

const TRANSITION_FRAMES = 15;

export const MASTER_PROMO_DURATION =
  HERO_INTRO_DURATION +
  HARNESS_EXPLAINER_DURATION +
  FEATURE_TOUR_DURATION +
  TRANSPARENCY_STORY_DURATION +
  CTA_OUTRO_DURATION -
  TRANSITION_FRAMES * 4;

/** ~2 min full marketing reel — all chapters with cross-fades. */
export const MasterPromo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#020408" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={HERO_INTRO_DURATION}>
        <HeroIntro />
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
      <TransitionSeries.Sequence durationInFrames={FEATURE_TOUR_DURATION}>
        <FeatureTourFull />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={TRANSPARENCY_STORY_DURATION}>
        <TransparencyStory />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={CTA_OUTRO_DURATION}>
        <CTAOutro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

/** Shorter social cut — hero + one feature beat + CTA. */
export const SocialTeaser: React.FC = () => (
  <AbsoluteFill>
    <Series>
      <Series.Sequence durationInFrames={12 * VIDEO.fps}>
        <HeroIntro />
      </Series.Sequence>
      <Series.Sequence durationInFrames={8 * VIDEO.fps}>
        <TransparencyStory />
      </Series.Sequence>
      <Series.Sequence durationInFrames={CTA_OUTRO_DURATION}>
        <CTAOutro />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);

export const SOCIAL_TEASER_DURATION = 12 * VIDEO.fps + 8 * VIDEO.fps + CTA_OUTRO_DURATION;
