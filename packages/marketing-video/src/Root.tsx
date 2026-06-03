import React from "react";
import { Composition } from "remotion";
import { HeroIntro, HERO_INTRO_DURATION } from "./compositions/HeroIntro";
import { HarnessExplainer, HARNESS_EXPLAINER_DURATION } from "./compositions/HarnessExplainer";
import { FeatureTourFull, FEATURE_TOUR_DURATION } from "./compositions/FeatureTour";
import { TransparencyStory, TRANSPARENCY_STORY_DURATION } from "./compositions/TransparencyStory";
import { CTAOutro, CTA_OUTRO_DURATION } from "./compositions/CTAOutro";
import {
  MasterPromo,
  MASTER_PROMO_DURATION,
  SocialTeaser,
  SOCIAL_TEASER_DURATION,
} from "./compositions/MasterPromo";
import { VIDEO } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Liminal-Hero"
      component={HeroIntro}
      durationInFrames={HERO_INTRO_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Harness"
      component={HarnessExplainer}
      durationInFrames={HARNESS_EXPLAINER_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Features"
      component={FeatureTourFull}
      durationInFrames={FEATURE_TOUR_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Transparency"
      component={TransparencyStory}
      durationInFrames={TRANSPARENCY_STORY_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-CTA"
      component={CTAOutro}
      durationInFrames={CTA_OUTRO_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Promo-Full"
      component={MasterPromo}
      durationInFrames={MASTER_PROMO_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Social-Teaser"
      component={SocialTeaser}
      durationInFrames={SOCIAL_TEASER_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  </>
);
