import React, { useEffect, useRef } from "react";
import type { SlashCompletionItem } from "@liminal/core";

const CYAN = "var(--lim-accent, #00d4ff)";

export function SlashCommandMenu({
  items,
  selectedIndex,
  onSelect,
  visible,
}: {
  items: SlashCompletionItem[];
  selectedIndex: number;
  onSelect: (item: SlashCompletionItem) => void;
  visible: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visible || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, visible]);

  if (!visible || items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash command completions"
      className="lim-slash-menu"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "100%",
        marginBottom: 6,
        maxHeight: 220,
        overflowY: "auto",
        zIndex: 20,
        background: "rgba(6,12,22,0.97)",
        border: "1px solid rgba(var(--lim-accent-rgb),0.22)",
        borderRadius: 8,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
        fontFamily: "var(--lim-font-mono, Consolas, monospace)",
        fontSize: 11,
      }}
    >
      {items.map((item, idx) => {
        const active = idx === selectedIndex;
        return (
          <button
            key={`${item.label}-${idx}`}
            type="button"
            role="option"
            aria-selected={active}
            data-idx={idx}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            style={{
              display: "flex",
              width: "100%",
              textAlign: "left",
              gap: 10,
              alignItems: "baseline",
              padding: "8px 10px",
              border: "none",
              borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.06)",
              background: active ? "rgba(var(--lim-accent-rgb),0.12)" : "transparent",
              color: active ? CYAN : "var(--lim-text, #c8d4e0)",
              cursor: "pointer",
            }}
          >
            <span style={{ minWidth: 120, fontWeight: 600 }}>{item.label}</span>
            {item.detail ? (
              <span style={{ flex: 1, opacity: 0.72, lineHeight: 1.35 }}>{item.detail}</span>
            ) : null}
          </button>
        );
      })}
      <div
        style={{
          padding: "6px 10px",
          fontSize: 10,
          opacity: 0.45,
          borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
        }}
      >
        Tab complete · ↑↓ navigate · Esc dismiss
      </div>
    </div>
  );
}
