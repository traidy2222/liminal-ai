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
import { DesktopHeroIntro, DESKTOP_HERO_DURATION } from "./compositions/DesktopHeroIntro";
import {
  DesktopFeatureTourFull,
  DESKTOP_FEATURE_TOUR_DURATION,
} from "./compositions/DesktopFeatureTour";
import {
  DesktopTransparencyStory,
  DESKTOP_TRANSPARENCY_DURATION,
} from "./compositions/DesktopTransparencyStory";
import { DesktopCTAOutro, DESKTOP_CTA_DURATION } from "./compositions/DesktopCTAOutro";
import {
  DesktopPromoFull,
  DesktopSocialTeaser,
  DESKTOP_PROMO_DURATION,
  DESKTOP_SOCIAL_TEASER_DURATION,
} from "./compositions/DesktopPromo";
import { VIDEO } from "./theme";
import {
  DesktopCinematic,
  DESKTOP_CINEMATIC_DURATION,
} from "./compositions/DesktopCinematic";
import { HeroAmbient, HERO_AMBIENT_DURATION } from "./compositions/HeroAmbient";
import { CINEMA_VIDEO } from "./cinematic/cinema";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Liminal-Desktop-Cinematic"
      component={DesktopCinematic}
      durationInFrames={DESKTOP_CINEMATIC_DURATION}
      fps={CINEMA_VIDEO.fps}
      width={CINEMA_VIDEO.width}
      height={CINEMA_VIDEO.height}
    />
    <Composition
      id="Liminal-Hero-Ambient"
      component={HeroAmbient}
      durationInFrames={HERO_AMBIENT_DURATION}
      fps={CINEMA_VIDEO.fps}
      width={CINEMA_VIDEO.width}
      height={CINEMA_VIDEO.height}
    />
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
    <Composition
      id="Liminal-Desktop-Hero"
      component={DesktopHeroIntro}
      durationInFrames={DESKTOP_HERO_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Desktop-Features"
      component={DesktopFeatureTourFull}
      durationInFrames={DESKTOP_FEATURE_TOUR_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Desktop-Transparency"
      component={DesktopTransparencyStory}
      durationInFrames={DESKTOP_TRANSPARENCY_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Desktop-CTA"
      component={DesktopCTAOutro}
      durationInFrames={DESKTOP_CTA_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Desktop-Promo-Full"
      component={DesktopPromoFull}
      durationInFrames={DESKTOP_PROMO_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="Liminal-Desktop-Social-Teaser"
      component={DesktopSocialTeaser}
      durationInFrames={DESKTOP_SOCIAL_TEASER_DURATION}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  </>
);
