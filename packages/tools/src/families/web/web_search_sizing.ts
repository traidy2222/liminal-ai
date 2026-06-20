import { isBriefResearchAsk, resolveEffortLevel, type EffortLevel } from "@liminal/core";

const BROAD_QUERY_RE =
  /\b(overview|comprehensive|compare|comparison|history|latest|analysis|deep dive|landscape|timeline|background|state of|what happened|who is|explain)\b/i;

const NAVIGATIONAL_MAX = 5;
const ABS_MIN = 3;
const ABS_MAX = 25;

export type WebSearchSizingMode = "explicit" | "brief" | "navigational" | "broad" | "effort";

export interface WebSearchMaxResult {
  max: number;
  mode: WebSearchSizingMode;
  effort: EffortLevel;
}

function effortBase(effort: EffortLevel): number {
  switch (effort) {
    case "low":
      return 4;
    case "medium":
      return 7;
    case "high":
      return 10;
    case "xhigh":
      return 14;
  }
}

function clampMax(n: number): number {
  return Math.max(ABS_MIN, Math.min(ABS_MAX, Math.round(n)));
}

/**
 * No fixed default — breadth scales from output effort, query shape, and optional explicit cap.
 */
export function resolveWebSearchMaxResults(input: {
  query: string;
  explicitMax?: number;
}): WebSearchMaxResult {
  const effort = resolveEffortLevel();
  const query = input.query.trim();

  if (input.explicitMax != null && Number.isFinite(input.explicitMax)) {
    return {
      max: clampMax(input.explicitMax),
      mode: "explicit",
      effort,
    };
  }

  if (isBriefResearchAsk(query)) {
    return { max: 4, mode: "brief", effort };
  }

  const tokens = query.split(/\s+/).filter(Boolean).length;
  if (tokens <= 3) {
    return { max: NAVIGATIONAL_MAX, mode: "navigational", effort };
  }

  let max = effortBase(effort);
  if (BROAD_QUERY_RE.test(query) || tokens >= 9) {
    max += 3;
    return { max: clampMax(max), mode: "broad", effort };
  }

  return { max: clampMax(max), mode: "effort", effort };
}

export function formatWebSearchSizingNote(sizing: WebSearchMaxResult): string {
  if (sizing.mode === "explicit") return `max=${sizing.max} (explicit)`;
  return `max=${sizing.max} (auto:${sizing.mode}, effort=${sizing.effort})`;
}
