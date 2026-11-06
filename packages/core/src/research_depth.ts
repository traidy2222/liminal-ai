/** Research depth follows evidence gaps, not a tool or section quota. */
export function buildResearchTurnInjection(_input: {userMessage:string}): string {
  return "[RESEARCH TURN] Use current evidence for time-sensitive claims. Scale research to the question; stop when material claims are supported. Reuse relevant observations, fetch independent sources in parallel when useful, and cite the evidence near the claims. Pending URLs are optional leads. Choose the requested answer format; explain a material gap when evidence is unavailable.";
}
