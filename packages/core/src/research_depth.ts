/**
 * Research-turn system injection — autonomous depth only. The harness does not
 * cap, floor, or nudge web_search/web_fetch counts; the model decides how many
 * tools the ask needs (one lookup vs a long investigation).
 */

import { isBriefResearchAsk } from "./research_continuation.js";

/** Opening injection for research-classified turns. */
export function buildResearchTurnInjection(input: { userMessage: string }): string {
  const brief = isBriefResearchAsk(input.userMessage);
  const scaleNote = brief
    ? "The user asked for brevity — one tight search+fetch pass is fine when it fully answers the question."
    : "You decide how much web research this ask needs: a simple fact may be one search+fetch; a broad or contested topic may need many loops. There is no default quota — use research_state to see what you have done and keep going only while material gaps remain.";

  const expertNote = brief
    ? ""
    : "Expert human pattern: run several web_search queries with different intent angles (background, current status, primary sources, dissent); " +
      "web_fetch multiple independent pending URLs in parallel (not only the top hit); call research_state before synthesizing; cross-check key claims across source tiers. ";

  return (
    "[RESEARCH TURN] The user needs current, sourced information — not a reasoning essay. " +
    "After at most a few sentences of native reasoning, call web_search and web_fetch (and recall_relevant / vault_search when prior briefings may exist). " +
    "Work in loops when needed: search → research_state (inventory) → web_fetch pending URLs → hypothesize() if direction is unclear → narrow searches for gaps. " +
    "Run parallel web_fetch on independent sources when useful. Do not narrate planned tools in reasoning — execute them. " +
    expertNote +
    `${scaleNote} ` +
    "Stop when coverage matches the ask and [OUTPUT EFFORT], not because you hit a habitual number of searches. " +
    "When evidence is sufficient, reply in chat. vault_write/remember are optional — not a substitute for answering."
  );
}
