import type { DocumentIR } from "@liminal/core";
import { computeStyleDistance, loadRecentIR } from "./doc_engine.js";

export async function isStyleDiverseEnough(style: DocumentIR["style"]): Promise<boolean> {
  const min = Number(process.env["AGENT_DOC_STYLE_DIVERSITY_MIN"] ?? "0.12");
  const recent = await loadRecentIR(6);
  if (recent.length === 0) return true;
  const distances = recent.map((doc) => computeStyleDistance(style, doc.style));
  const best = Math.min(...distances);
  return best >= min;
}

