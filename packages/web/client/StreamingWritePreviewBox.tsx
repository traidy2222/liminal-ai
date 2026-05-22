import { useEffect, useRef, useState } from "react";
import {
  extractStreamingWritePreview,
  isStreamingWriteTool,
} from "@liminal/core/streaming-write-preview";

const STALL_NO_GROWTH_MS = 12_000;

export function StreamingWritePreviewBox({
  toolName,
  argsJson,
  isActive,
  elapsedMs,
  compact = false,
}: {
  toolName: string;
  argsJson: string;
  isActive: boolean;
  elapsedMs: number;
  compact?: boolean;
}) {
  const [, setTick] = useState(0);
  const preview = isStreamingWriteTool(toolName)
    ? extractStreamingWritePreview(toolName, argsJson, {
        tailLines: compact ? 8 : 14,
        maxChars: compact ? 12_000 : 24_000,
      })
    : null;

  const lastCharCount = useRef(0);
  const lastGrowthAt = useRef(Date.now());
  const previewMaxHeight = compact ? 140 : 240;

  useEffect(() => {
    if (!isActive || !preview) return;
    const n = preview.charCount;
    if (n > lastCharCount.current) {
      lastCharCount.current = n;
      lastGrowthAt.current = Date.now();
    }
  }, [isActive, preview?.charCount, preview?.content]);

  useEffect(() => {
    if (!isActive) {
      lastCharCount.current = 0;
      lastGrowthAt.current = Date.now();
      return;
    }
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive, toolName]);

  if (!isActive || !preview) return null;

  const stalled =
    preview.incomplete &&
    elapsedMs > STALL_NO_GROWTH_MS &&
    Date.now() - lastGrowthAt.current > STALL_NO_GROWTH_MS;

  const hasBody = preview.content.length > 0 || Boolean(preview.rawArgsTail);
  const tailLineCount = preview.content ? preview.content.split("\n").length : 0;
  const linesAbove = Math.max(0, preview.lineCount - tailLineCount);

  return (
    <div
      style={{
        marginTop: 8,
        border: `1px solid ${stalled ? "rgba(255,140,60,0.45)" : "rgba(var(--lim-accent-rgb),0.28)"}`,
        borderRadius: 6,
        background: stalled ? "rgba(255,100,40,0.06)" : "rgba(0,12,24,0.62)",
        overflow: "hidden",
        boxShadow: preview.charCount > 0 ? "0 0 0 1px rgba(var(--lim-accent-rgb),0.06)" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.12)",
          fontFamily: "monospace",
          fontSize: 10,
        }}
      >
        <span style={{ color: "#6688aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {preview.label ? (
            <>
              <span style={{ color: "#99bbdd" }}>{preview.field ?? "payload"}</span>
              {" → "}
              {preview.label}
            </>
          ) : (
            <span style={{ color: "#99bbdd" }}>{preview.field ?? "streaming payload"}</span>
          )}
        </span>
        <span style={{ color: stalled ? "#ffaa66" : "#88aacc", flexShrink: 0 }}>
          {preview.charCount > 0
            ? `${preview.charCount.toLocaleString()} chars · ${preview.lineCount} lines`
            : "waiting for body…"}
          {preview.incomplete ? " · live" : " · done"}
        </span>
      </div>

      {hasBody ? (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            maxHeight: previewMaxHeight,
            overflow: "auto",
            fontSize: 11,
            lineHeight: 1.45,
            color: "#9ab4cc",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {linesAbove > 0 && (
            <span style={{ color: "#445566", display: "block", marginBottom: 4 }}>
              ⋯ {linesAbove} line{linesAbove !== 1 ? "s" : ""} above
            </span>
          )}
          {preview.content || preview.rawArgsTail}
        </pre>
      ) : (
        <div style={{ padding: "10px 10px", color: "#556677", fontSize: 10, fontStyle: "italic" }}>
          Receiving tool JSON from the model — story/code preview appears once the{" "}
          <code style={{ color: "#88aacc" }}>content</code> field starts streaming.
        </div>
      )}

      {preview.charCount > 0 && preview.incomplete && (
        <div
          style={{
            padding: "5px 8px",
            fontSize: 9,
            color: "#556677",
            borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
            fontFamily: "monospace",
          }}
        >
          Live preview — file saves to disk once the model closes the content field in this tool call.
        </div>
      )}

      {stalled && (
        <div
          style={{
            padding: "6px 8px",
            fontSize: 10,
            color: "#ffaa66",
            borderTop: "1px solid rgba(255,140,60,0.25)",
            fontFamily: "monospace",
          }}
        >
          No new payload for {Math.round((Date.now() - lastGrowthAt.current) / 1000)}s — provider may be
          stalled (check RAW / Express logs).
        </div>
      )}
    </div>
  );
}
