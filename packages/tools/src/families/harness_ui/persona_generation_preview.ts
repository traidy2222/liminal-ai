import {
  PERSONA_ARTIFACT_LABELS,
  PERSONA_ARTIFACT_ORDER,
  type PersonaArtifactId,
  type PersonaArtifactPreview,
  type PersonaArtifactStatus,
  type PersonaProgressDetail,
} from "@liminal/core/persona-bootstrap-progress";
import { effectiveHarnessEnvRaw } from "@liminal/core";

export type { PersonaProgressDetail } from "@liminal/core/persona-bootstrap-progress";

export type PersonaProgressFn = (
  stage: string,
  message: string,
  detail?: PersonaProgressDetail
) => void;

export function personaGenerationStreamEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_PERSONA_GENERATION_STREAM")?.trim() !== "0";
}

export function resolvePersonaPreviewMaxChars(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_PREVIEW_MAX_CHARS") ?? "16000", 10);
  if (!Number.isFinite(n)) return 16_000;
  return Math.max(2000, Math.min(32_000, n));
}

function capContent(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(content.length - max);
}

export class PersonaGenerationPreview {
  private readonly maxChars: number;
  private readonly slots = new Map<PersonaArtifactId, PersonaArtifactPreview>();

  constructor(
    private readonly onProgress?: PersonaProgressFn,
    private readonly onArtifactDone?: (id: PersonaArtifactId, content: string) => Promise<void>
  ) {
    this.maxChars = resolvePersonaPreviewMaxChars();
    for (const id of PERSONA_ARTIFACT_ORDER) {
      this.slots.set(id, {
        id,
        label: PERSONA_ARTIFACT_LABELS[id],
        status: "pending",
        content: "",
        charCount: 0,
        incomplete: false,
      });
    }
  }

  bindProgress(fn?: PersonaProgressFn): PersonaProgressFn {
    return (stage, message, detail) => {
      if (detail?.artifacts?.length) {
        for (const a of detail.artifacts) {
          const cur = this.slots.get(a.id);
          if (cur) this.slots.set(a.id, { ...cur, ...a });
        }
      }
      this.emit(stage, message);
    };
  }

  private snapshot(): PersonaArtifactPreview[] {
    return PERSONA_ARTIFACT_ORDER.map((id) => {
      const s = this.slots.get(id)!;
      return {
        ...s,
        content: capContent(s.content, this.maxChars),
        charCount: s.content.length,
      };
    });
  }

  emit(stage: string, message: string): void {
    this.onProgress?.(stage, message, { artifacts: this.snapshot() });
  }

  setStatus(id: PersonaArtifactId, status: PersonaArtifactStatus): void {
    const cur = this.slots.get(id);
    if (!cur) return;
    this.slots.set(id, { ...cur, status });
  }

  streamContent(id: PersonaArtifactId, content: string, incomplete = true): void {
    const cur = this.slots.get(id);
    if (!cur) return;
    this.slots.set(id, {
      ...cur,
      status: "streaming",
      content,
      charCount: content.length,
      incomplete,
    });
  }

  async completeArtifact(id: PersonaArtifactId, content: string): Promise<void> {
    const cur = this.slots.get(id);
    if (!cur) return;
    this.slots.set(id, {
      ...cur,
      status: "done",
      content,
      charCount: content.length,
      incomplete: false,
    });
    if (this.onArtifactDone) {
      await this.onArtifactDone(id, content);
    }
  }

  errorArtifact(id: PersonaArtifactId, content: string): void {
    const cur = this.slots.get(id);
    if (!cur) return;
    this.slots.set(id, {
      ...cur,
      status: "error",
      content,
      charCount: content.length,
      incomplete: false,
    });
  }

  showScaffoldSoul(scaffold: {
    identityMd: string;
    voiceMd: string;
    stanceMd: string;
    railsMd: string;
  }): void {
    this.streamContent("soul_identity", scaffold.identityMd, true);
    this.streamContent("soul_voice", scaffold.voiceMd, true);
    this.streamContent("soul_stance", scaffold.stanceMd, true);
    this.streamContent("soul_rails", scaffold.railsMd, true);
  }

  applyPartialSoulBatch(partial: {
    identityMd?: string;
    voiceMd?: string;
    stanceMd?: string;
    railsMd?: string;
  }): void {
    if (partial.identityMd !== undefined) this.streamContent("soul_identity", partial.identityMd, true);
    if (partial.voiceMd !== undefined) this.streamContent("soul_voice", partial.voiceMd, true);
    if (partial.stanceMd !== undefined) this.streamContent("soul_stance", partial.stanceMd, true);
    if (partial.railsMd !== undefined) this.streamContent("soul_rails", partial.railsMd, true);
  }
}
