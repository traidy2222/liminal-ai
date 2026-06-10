import React, { useCallback, useRef } from "react";

export type PanelResizeAxis = "horizontal" | "vertical";

export interface PanelResizeHandleProps {
  axis: PanelResizeAxis;
  onDragDelta: (delta: number) => void;
}

/**
 * Drag handle for resizing panels.
 * Vertical: drag up increases delta (taller panel below).
 * Horizontal: drag right increases delta (wider panel to the right).
 */
export function PanelResizeHandle({ axis, onDragDelta }: PanelResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      lastPos.current = axis === "vertical" ? e.clientY : e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [axis]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const pos = axis === "vertical" ? e.clientY : e.clientX;
      const raw = pos - lastPos.current;
      lastPos.current = pos;
      const delta = axis === "vertical" ? -raw : raw;
      if (delta !== 0) onDragDelta(delta);
    },
    [axis, onDragDelta]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const vertical = axis === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        flexShrink: 0,
        width: vertical ? "100%" : 8,
        height: vertical ? 8 : "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: vertical ? "row-resize" : "col-resize",
        touchAction: "none",
        background: "transparent",
      }}
    >
      <div
        style={{
          width: vertical ? 56 : 3,
          height: vertical ? 3 : 56,
          borderRadius: 2,
          background: "rgba(var(--lim-accent-rgb),0.4)",
        }}
      />
    </div>
  );
}
