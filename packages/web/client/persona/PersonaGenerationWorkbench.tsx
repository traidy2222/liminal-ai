import {
  PERSONA_ARTIFACT_LABELS,
  PERSONA_ARTIFACT_ORDER,
  type PersonaArtifactPreview,
} from "@liminal/core/persona-bootstrap-progress";
import { PersonaArtifactPanel } from "./PersonaArtifactPanel.js";

function mergeArtifacts(
  incoming: PersonaArtifactPreview[] | null | undefined
): PersonaArtifactPreview[] {
  const byId = new Map<PersonaArtifactPreview["id"], PersonaArtifactPreview>();
  for (const id of PERSONA_ARTIFACT_ORDER) {
    byId.set(id, {
      id,
      label: PERSONA_ARTIFACT_LABELS[id],
      status: "pending",
      content: "",
      charCount: 0,
      incomplete: false,
    });
  }
  for (const a of incoming ?? []) {
    const cur = byId.get(a.id);
    if (cur) byId.set(a.id, { ...cur, ...a, label: a.label || cur.label });
  }
  return PERSONA_ARTIFACT_ORDER.map((id) => byId.get(id)!);
}

export function PersonaGenerationWorkbench({
  artifacts,
  progress,
  stageHint,
}: {
  artifacts: PersonaArtifactPreview[] | null;
  progress: string | null;
  stageHint?: string;
}) {
  const panels = mergeArtifacts(artifacts);

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          marginBottom: 8,
          padding: "8px 10px",
          border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
          background: "rgba(var(--lim-accent-rgb),0.06)",
          color: "rgba(var(--lim-accent-rgb),0.95)",
          fontSize: 12,
          fontFamily: "monospace",
          letterSpacing: "0.03em",
        }}
      >
        {progress ?? "Working…"}
        {stageHint ? ` · ${stageHint}` : ""}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 8,
        }}
      >
        {panels.map((artifact) => (
          <PersonaArtifactPanel key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}
