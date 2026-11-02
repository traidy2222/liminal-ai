import { useState } from "react";
import { webApiFetch } from "./webApiAuth.js";
export function WorkflowDeliverables({ output }: { output: string }) {
  const [error, setError] = useState("");
  let data: { id?: string; status?: string; files?: unknown };
  try {
    data = JSON.parse(output);
  } catch {
    return null;
  }
  if (
    !data.id ||
    !/^[a-f0-9-]{36}$/i.test(data.id) ||
    !Array.isArray(data.files) ||
    !data.files.length
  )
    return null;
  const files = data.files.filter(
    (f): f is string =>
      typeof f === "string" && /^[a-z-]+\.(html|md|eml|json|diff|txt)$/.test(f),
  );
  async function download(name: string) {
    try {
      setError("");
      const res = await webApiFetch(
        `/api/workflows/${data.id}/files/${encodeURIComponent(name)}`,
      );
      if (!res.ok)
        throw Error(
          "This deliverable is unavailable in the active workspace. Resume the run in its original workspace.",
        );
      const blob = await res.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section
      aria-label="Workflow deliverables"
      style={{
        fontFamily: "var(--lim-font-body, system-ui, sans-serif)",
        color: "var(--lim-text, #e5e7ef)",
        marginTop: 10,
        padding: 12,
        background: "var(--lim-surface, #20202a)",
        borderRadius: 8,
      }}
    >
      <strong style={{ fontSize: 12 }}>
        Saved for {data.status === "verified_patch" ? "handoff" : "review"}
      </strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {files.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => void download(name)}
            style={{
              font: "inherit",
              fontSize: 12,
              padding: "6px 9px",
              border: "1px solid var(--lim-border, #67616f)",
              borderRadius: 5,
              color: "inherit",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {name} ↓
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
