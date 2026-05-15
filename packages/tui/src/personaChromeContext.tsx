import React, { createContext, useContext } from "react";
import {
  DEFAULT_PERSONA_UI_THEME,
  mapPersonaUiThemeToInk,
  motionPresetToStatusBarIntervalMs,
  type PersonaUiThemeV1,
} from "@liminal/core";
import { jarvis } from "./theme/jarvis.js";

export type TuiJarvisColors = typeof jarvis;

export type TuiPersonaChrome = {
  colors: TuiJarvisColors;
  statusBarIntervalMs: number;
};

function buildChromeFromTheme(theme: PersonaUiThemeV1 | null): TuiPersonaChrome {
  const t = theme ?? DEFAULT_PERSONA_UI_THEME;
  const ink = mapPersonaUiThemeToInk(t);
  return {
    colors: {
      ...jarvis,
      accent: ink.accent as TuiJarvisColors["accent"],
      userMark: ink.accent as TuiJarvisColors["userMark"],
      assistant: ink.success as TuiJarvisColors["assistant"],
      warn: ink.warn as TuiJarvisColors["warn"],
      danger: ink.danger as TuiJarvisColors["danger"],
      meta: ink.secondary as TuiJarvisColors["meta"],
      muted: ink.muted as TuiJarvisColors["muted"],
      borderStrong: ink.accent as TuiJarvisColors["borderStrong"],
      borderSoft: ink.muted as TuiJarvisColors["borderSoft"],
      body: jarvis.body,
    },
    statusBarIntervalMs: motionPresetToStatusBarIntervalMs(t.motion),
  };
}

const defaultChrome = buildChromeFromTheme(null);

export const PersonaChromeContext = createContext<TuiPersonaChrome>(defaultChrome);

export function usePersonaChrome(): TuiPersonaChrome {
  return useContext(PersonaChromeContext);
}

export { buildChromeFromTheme };
