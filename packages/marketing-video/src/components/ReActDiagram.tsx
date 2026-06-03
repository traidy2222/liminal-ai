import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LIMINAL_THEME } from "../theme";

type NodeId = "user" | "model" | "tools" | "memory" | "context";

type NodeDef = {
  label: string;
  /** Short lines only — kept inside the box via line clamp. */
  subLines: string[];
  leftPct: number;
  topPct: number;
  width: number;
  color: string;
};

const NODES: Record<NodeId, NodeDef> = {
  user: {
    label: "You",
    subLines: ["task + approvals"],
    leftPct: 5,
    topPct: 58,
    width: 176,
    color: LIMINAL_THEME.textMuted,
  },
  model: {
    label: "Model",
    subLines: ["ReAct loop"],
    leftPct: 26,
    topPct: 34,
    width: 176,
    color: LIMINAL_THEME.accent,
  },
  tools: {
    label: "Tools",
    subLines: ["files · shell · git", "web · browser"],
    leftPct: 52,
    topPct: 6,
    width: 200,
    color: LIMINAL_THEME.success,
  },
  memory: {
    label: "Memory",
    subLines: ["BM25 + vectors", "Obsidian vault"],
    leftPct: 74,
    topPct: 36,
    width: 196,
    color: LIMINAL_THEME.secondary,
  },
  context: {
    label: "Context",
    subLines: ["compress · distill", "artifact trace"],
    leftPct: 54,
    topPct: 60,
    width: 196,
    color: LIMINAL_THEME.warn,
  },
};

const NODE_H = 96;
const PAD_X = 14;
const PAD_Y = 12;

const EDGES: [NodeId, NodeId][] = [
  ["user", "model"],
  ["model", "tools"],
  ["tools", "model"],
  ["model", "memory"],
  ["memory", "model"],
  ["model", "context"],
  ["context", "model"],
];

/** Diagram area ≈ flex region below header (px refs for edge anchors in 0–100 viewBox). */
const DIAGRAM_W = 1728;
const DIAGRAM_H = 520;

/** Center of each node as % of diagram (matches CSS left/top + width/height). */
const anchor = (id: NodeId): { x: number; y: number } => {
  const n = NODES[id];
  return {
    x: n.leftPct + (n.width / DIAGRAM_W) * 50,
    y: n.topPct + (NODE_H / DIAGRAM_H) * 50,
  };
};

const DiagramNode: React.FC<{
  node: NodeDef;
  opacity: number;
  scale: number;
  glow: number;
}> = ({ node, opacity, scale, glow }) => (
  <div
    style={{
      position: "absolute",
      left: `${node.leftPct}%`,
      top: `${node.topPct}%`,
      width: node.width,
      height: NODE_H,
      boxSizing: "border-box",
      padding: `${PAD_Y}px ${PAD_X}px`,
      borderRadius: 10,
      background: LIMINAL_THEME.bgElevated,
      border: `2px solid ${node.color}`,
      overflow: "hidden",
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      boxShadow: `0 0 ${20 * glow}px ${node.color}55`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      gap: 6,
    }}
  >
    <div
      style={{
        fontFamily: LIMINAL_THEME.fontSans,
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 1.15,
        color: node.color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {node.label}
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {node.subLines.map((line) => (
        <div
          key={line}
          style={{
            fontFamily: LIMINAL_THEME.fontMono,
            fontSize: 11,
            lineHeight: 1.35,
            color: LIMINAL_THEME.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  </div>
);

export const ReActDiagram: React.FC<{ highlightPhase?: number }> = ({
  highlightPhase = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = (frame / 30) % 1;

  return (
    <AbsoluteFill style={{ fontFamily: LIMINAL_THEME.fontSans }}>
      {/* Edge layer — viewBox 0–100 for stable % anchors */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {EDGES.map(([from, to], i) => {
          const a = anchor(from);
          const b = anchor(to);
          const dash = interpolate(
            (frame + i * 8) % 60,
            [0, 60],
            [0, 6],
            { extrapolateRight: "clamp" },
          );
          const active =
            highlightPhase === 0 ||
            (highlightPhase === 1 && from === "user") ||
            (highlightPhase === 2 && (from === "model" || to === "tools")) ||
            (highlightPhase === 3 && (from === "memory" || to === "memory")) ||
            (highlightPhase === 4 && (from === "context" || to === "context"));

          return (
            <line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? LIMINAL_THEME.accent : LIMINAL_THEME.textDim}
              strokeWidth={active ? 0.35 : 0.15}
              strokeOpacity={active ? 0.65 : 0.22}
              strokeDasharray="1.2 0.9"
              strokeDashoffset={dash}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {(Object.keys(NODES) as NodeId[]).map((id, i) => {
        const n = NODES[id];
        const pop = spring({
          frame: frame - i * 6,
          fps,
          config: { damping: 200 },
        });
        const glow =
          id === "model"
            ? 0.35 + Math.sin(frame / 20) * 0.12
            : pulse > 0.5 && highlightPhase > 0
              ? 0.2
              : 0.08;

        return (
          <DiagramNode
            key={id}
            node={n}
            opacity={pop}
            scale={pop}
            glow={glow}
          />
        );
      })}
    </AbsoluteFill>
  );
};
