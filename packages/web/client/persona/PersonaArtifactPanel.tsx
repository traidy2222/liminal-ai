import { useEffect, useRef } from "react";
import type { PersonaArtifactPreview } from "@liminal/core/persona-bootstrap-progress";

const STATUS_LABEL: Record<PersonaArtifactPreview["status"], string> = {
  pending: "pending",
  streaming: "streaming",
  done: "done",
  error: "error",
};

const STATUS_COLOR: Record<PersonaArtifactPreview["status"], string> = {
  pending: "#6a7a8a",
  streaming: "rgba(var(--lim-accent-rgb),0.95)",
  done: "rgba(var(--lim-success-rgb),0.9)",
  error: "rgba(var(--lim-danger-rgb),0.9)",
};

export function PersonaArtifactPanel({ artifact }: { artifact: PersonaArtifactPreview }) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [artifact.content, artifact.status]);

  const streaming = artifact.status === "streaming";
  const body = artifact.content || (artifact.status === "pending" ? "—" : "");

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        border: `1px solid ${streaming ? "rgba(var(--lim-accent-rgb),0.35)" : "rgba(var(--lim-border-rgb),0.35)"}`,
        borderRadius: 6,
        background: "rgba(0,10,22,0.55)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid rgba(var(--lim-border-rgb),0.2)",
          fontFamily: "monospace",
          fontSize: 10,
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ color: "#a8b8c8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {artifact.label}
        </span>
        <span style={{ color: STATUS_COLOR[artifact.status], flexShrink: 0 }}>
          {STATUS_LABEL[artifact.status]}
        </span>
      </header>
      <pre
        ref={preRef}
        style={{
          flex: 1,
          margin: 0,
          padding: "8px",
          fontSize: 10,
          lineHeight: 1.45,
          fontFamily: "ui-monospace, monospace",
          color: streaming ? "#d8e8f8" : "#9aa8b8",
          overflow: "auto",
          maxHeight: 160,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {body}
        {streaming && artifact.incomplete !== false ? (
          <span style={{ color: "rgba(var(--lim-accent-rgb),0.9)" }}>▌</span>
        ) : null}
      </pre>
    </article>
  );
}
