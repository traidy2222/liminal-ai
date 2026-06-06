import type React from "react";
import { countPlanStepsDone, isPlanStepDone, planStepLabel } from "./planStepUtils.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const GREEN = "var(--lim-success, #3dd68c)";
const MUTED = "#667788";

interface Props {
  steps: string[];
  streaming?: boolean;
  previewText?: string;
}

export function PlanProgressBlock({ steps, streaming, previewText }: Props) {
  if (steps.length === 0) {
    if (streaming && previewText?.trim()) {
      return (
        <div style={styles.card}>
          <div style={styles.header}>
            <span style={{ color: CYAN, fontWeight: 700 }}>Progress</span>
            <span style={{ color: MUTED, fontSize: 11 }}>drafting…</span>
          </div>
          <pre style={styles.preview}>{previewText.slice(-800)}</pre>
        </div>
      );
    }
    return null;
  }

  const done = countPlanStepsDone(steps);
  const total = steps.length;
  const activeIndex = steps.findIndex((s) => !isPlanStepDone(s));
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={{ color: CYAN, fontWeight: 700, fontSize: 12, letterSpacing: "0.04em" }}>
          Progress
        </span>
        <span style={{ color: MUTED, fontSize: 11 }}>
          {done}/{total}
        </span>
      </div>
      <div style={styles.track}>
        <div style={{ ...styles.fill, width: `${pct}%` }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {steps.map((step, i) => {
          const complete = isPlanStepDone(step);
          const active = !complete && i === activeIndex;
          const text = complete ? planStepLabel(step) : step;
          const color = complete ? GREEN : active ? CYAN : MUTED;
          const marker = complete ? "✓" : active ? "▸" : "○";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                color,
                fontSize: 12,
                lineHeight: 1.5,
                opacity: complete ? 0.75 : 1,
              }}
            >
              <span style={{ flexShrink: 0, width: 14, textAlign: "center" }}>{marker}</span>
              <span style={{ textDecoration: complete ? "line-through" : "none" }}>{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: "10px 14px",
    background: "rgba(0,8,20,0.7)",
    border: "1px solid rgba(var(--lim-accent-rgb),0.1)",
    borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.35)",
    borderRadius: 4,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
  },
  track: {
    height: 3,
    borderRadius: 2,
    background: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: CYAN,
    borderRadius: 2,
    transition: "width 0.25s ease",
  },
  preview: {
    margin: 0,
    fontSize: 11,
    color: MUTED,
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
  },
};
