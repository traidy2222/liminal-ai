/**
 * One-off generator: writes packages/core/src/harness_settings_field_meta.ts
 * Run: node scripts/gen-harness-settings-meta.mjs
 */
import fs from "fs";

const inv = fs.readFileSync("packages/core/src/harness_env_inventory.ts", "utf8");
const start = inv.indexOf("HARNESS_MANAGED_ENV_KEYS");
const slice = inv.slice(start);
const keys = [];
for (const m of slice.matchAll(/"(AGENT_[A-Z0-9_]+)"/g)) {
  if (!keys.includes(m[1])) keys.push(m[1]);
}
if (keys.length < 140) throw new Error("parse fail " + keys.length);

function titleCase(s) {
  return s
    .replace(/^AGENT_/, "")
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function tabFor(key) {
  if (
    key === "AGENT_MEMORY_AUTOLINK_MODEL" ||
    key === "AGENT_MEMORY_CONSOLIDATE_MODEL" ||
    /^(AGENT_MODEL|AGENT_API_BASE_URL|AGENT_FAST_MODEL|AGENT_EMBED_MODEL|AGENT_PERSONA_INFER_MODEL|AGENT_PERSONA_GEN_|AGENT_SEND_TIMEOUT_MS|AGENT_STREAM_|AGENT_PROVIDER_CIRCUIT_|AGENT_RETRY_MAX_DELAY_MS|AGENT_RETRY_WALL_TIME_MS|AGENT_RATE_LIMIT_MAX_RETRIES|AGENT_TRANSIENT_5XX_MAX_RETRIES|AGENT_RETRY_FOREVER|AGENT_UPSTREAM_429_SUGGESTED_WAIT_MS|AGENT_PROVIDER_MIN_INTERVAL_MS)$/.test(key) ||
    key.startsWith("AGENT_VISION_")
  ) {
    return "models_api";
  }
  if (/^AGENT_CRITIC|^AGENT_FINALIZE|^AGENT_PSEUDO_TOOL|^AGENT_LENGTH_RESUME/.test(key)) {
    return "harness";
  }
  if (
    key.includes("SESSION") ||
    key.includes("GREET") ||
    key.includes("PERSONA_BOOTSTRAP") ||
    key === "AGENT_UI_VERBOSITY" ||
    key === "AGENT_LOCATION" ||
    key === "AGENT_SESSION_MODE" ||
    key === "AGENT_COMPRESS_SEMANTIC" ||
    key === "AGENT_YIELD_EVERY_N" ||
    key === "AGENT_PASTE" ||
    key.startsWith("AGENT_AUTO_DREAM") ||
    key.startsWith("AGENT_HEARTBEAT")
  ) {
    return "session_ui";
  }
  if (
    key.includes("MEMORY") ||
    key.includes("VAULT") ||
    key.startsWith("AGENT_OBSIDIAN") ||
    key.includes("RECALL") ||
    key.includes("QUERY_REWRITE") ||
    key.includes("SPECULATIVE_READS") ||
    key.includes("TOOL_BODY_ELIDE") ||
    key.includes("TOOL_ELIDE") ||
    key === "AGENT_DISTILL"
  ) {
    return "memory_vault";
  }
  if (
    key.includes("WEB_") ||
    key === "AGENT_BROWSER" ||
    key === "AGENT_WEB_RESEARCH" ||
    key === "AGENT_WEB_READABILITY" ||
    key.startsWith("AGENT_MARKETS_")
  ) {
    return "web_research";
  }
  if (
    key.includes("SAFETY") ||
    key.includes("APPROVAL") ||
    key === "AGENT_YOLO" ||
    key === "AGENT_RULE_RECALL" ||
    key === "AGENT_VAULT_AUTO_WRITE"
  ) {
    return "safety";
  }
  if (key.includes("DOC_")) return "documents";
  if (
    key.includes("GOLDEN") ||
    key.includes("FAILURE") ||
    key.includes("EVAL_JSON") ||
    key.includes("RECIPE") ||
    key.includes("PROTOCOL_INTENT") ||
    key === "AGENT_FAILURE_LOG" ||
    key === "AGENT_PLUGIN_DIR" ||
    key === "AGENT_PROCESS_HEALTH" ||
    key === "AGENT_LINT_ALLOWED_COMMANDS"
  ) {
    return "advanced";
  }
  return "harness";
}

function subgroupFor(key, tab) {
  if (tab === "models_api") {
    if (key.startsWith("AGENT_VISION_")) return "vision";
    if (key === "AGENT_MEMORY_AUTOLINK_MODEL" || key === "AGENT_MEMORY_CONSOLIDATE_MODEL") return "memory_models";
    if (key.startsWith("AGENT_PERSONA_")) return "persona_models";
    if (key.startsWith("AGENT_STREAM_") || key === "AGENT_SEND_TIMEOUT_MS") return "streaming";
    if (
      key.includes("RETRY") ||
      key.includes("RATE_LIMIT") ||
      key.includes("TRANSIENT") ||
      key.includes("PROVIDER_CIRCUIT") ||
      key.includes("UPSTREAM") ||
      key === "AGENT_PROVIDER_MIN_INTERVAL_MS"
    )
      return "resilience";
    return "routing";
  }
  if (tab === "session_ui") {
    if (key.startsWith("AGENT_HEARTBEAT")) return "heartbeat";
    if (key.startsWith("AGENT_AUTO_DREAM")) return "auto_dream";
    if (key.includes("SESSION_JSONL") || key === "AGENT_SESSION_MODE") return "session_recording";
    return "session_ui";
  }
  if (tab === "memory_vault") {
    if (key.startsWith("AGENT_OBSIDIAN") || key === "AGENT_VAULT_PATH") return "obsidian";
    if (key.includes("VAULT") && !key.includes("MEMORY")) return "vault_limits";
    if (key.includes("TOOL_BODY_ELIDE") || key.includes("TOOL_ELIDE") || key === "AGENT_DISTILL") return "context_shaping";
    if (key.includes("QUERY_REWRITE") || key.includes("RECALL") || key.includes("SPECULATIVE")) return "retrieval";
    return "memory";
  }
  if (tab === "web_research") {
    if (key.startsWith("AGENT_MARKETS_")) return "markets";
    if (key === "AGENT_BROWSER" || key === "AGENT_WEB_RESEARCH" || key === "AGENT_WEB_READABILITY") return "features";
    return "http_client";
  }
  if (tab === "safety") return "safety";
  if (tab === "documents") return "documents";
  if (tab === "advanced") {
    if (
      key === "AGENT_PLUGIN_DIR" ||
      key === "AGENT_PROCESS_HEALTH" ||
      key === "AGENT_LINT_ALLOWED_COMMANDS"
    ) {
      return "plugins";
    }
    return "telemetry";
  }
  if (key.startsWith("AGENT_CRITIC")) return "critic";
  if (key.startsWith("AGENT_SELF_HEAL")) return "self_heal";
  if (key.startsWith("AGENT_INTENT_")) return "intent";
  if (key.includes("CONCURRENT") || key.includes("CONCURRENCY")) return "orchestration";
  if (key.startsWith("AGENT_TOOL_LAZY") || key.includes("TOOLS_PROFILE")) return "tool_loading";
  if (key.includes("FINALIZE") || key.includes("PSEUDO_TOOL") || key.includes("LENGTH_RESUME")) return "finalize";
  if (key.includes("REFLEXION") || key.includes("OVERINFERENCE")) return "reflection";
  return "harness_misc";
}

const enumMap = {
  AGENT_UI_VERBOSITY: ["quiet", "normal"],
  AGENT_SESSION_JSONL_TEXT_LOG: ["rollup", "delta", "both"],
  AGENT_SELF_HEAL_LINT_MODE: ["tsc", "eslint", "command"],
  AGENT_CRITIC_MODE: ["single", "debate"],
  AGENT_HEARTBEAT_SURFACE: ["off", "trace", "assistant"],
  AGENT_ALWAYS_TOOLS_PROFILE: ["balanced", "knowledge_first", "max_autonomy"],
};

function kindFor(key) {
  if (enumMap[key]) return { valueKind: "enum", enumValues: enumMap[key] };
  if (
    /_MS$/.test(key) ||
    key.endsWith("_BYTES") ||
    key.endsWith("_RETRIES") ||
    key.endsWith("_FAILURES") ||
    key.endsWith("_N") ||
    key.endsWith("_MAX") ||
    key.endsWith("_MIN") ||
    key.endsWith("_HOURS") ||
    key.endsWith("_BUDGET") ||
    key.endsWith("_LOOKUPS") ||
    key.endsWith("_CHARS") ||
    key.endsWith("_TOKENS") ||
    key.endsWith("_DELAY_MS") ||
    key.endsWith("_INTERVAL_MS") ||
    key === "AGENT_CRITIC_MIN_TOOLS" ||
    key === "AGENT_MIN_CONCURRENT_AGENTS" ||
    key === "AGENT_YIELD_EVERY_N" ||
    key === "AGENT_RECALL_EVERY_N" ||
    key === "AGENT_TOOL_ELIDE_KEEP_ROUNDS" ||
    key === "AGENT_AUTO_DREAM_MAX_SESSION_FILES" ||
    key === "AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR" ||
    key === "AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS" ||
    key === "AGENT_SESSION_JSONL_MAX_ROLLUP_CHARS" ||
    key === "AGENT_DOC_QUALITY_MIN" ||
    key === "AGENT_DOC_REPAIR_BUDGET" ||
    key === "AGENT_DOC_MAX_SOURCE_LOOKUPS" ||
    key === "AGENT_AUTO_DREAM_MIN_SESSIONS"
  ) {
    return { valueKind: "number", numericBounds: {} };
  }
  if (
    key === "AGENT_INTENT_CONFIDENCE_MIN" ||
    key === "AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT" ||
    key === "AGENT_DOC_STYLE_DIVERSITY_MIN" ||
    key === "AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN"
  ) {
    return { valueKind: "number", numericBounds: { min: 0, max: 1, step: 0.01 } };
  }
  if (
    /^(AGENT_SESSION_GREET|AGENT_PERSONA_BOOTSTRAP|AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP|AGENT_SESSION_JSONL|AGENT_SESSION_JSONL_TRACE|AGENT_TOOL_BODY_ELIDE|AGENT_DISTILL|AGENT_QUERY_REWRITE|AGENT_QUERY_REWRITE_EXPLORATORY|AGENT_MEMORY_AUTO_EXTRACT|AGENT_MEMORY_GRAPH|AGENT_MEMORY_AUTOLINK|AGENT_MEMORY_EPISODE|AGENT_MEMORY_PRIME_ROUND0|AGENT_TOOL_LAZY|AGENT_SELF_HEAL_LINT|AGENT_SELF_HEAL_REPO_WIDE|AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS|AGENT_SAFETY_JUDGE|AGENT_WEB_READABILITY|AGENT_WEB_RESEARCH|AGENT_BROWSER|AGENT_DOC_ENGINE|AGENT_DOC_AUTONOMY|AGENT_DOC_WEB_ASSETS|AGENT_FAILURE_LOG|AGENT_CRITIC|AGENT_CRITIC_EVIDENCE|AGENT_EVAL_JSON_SINK|AGENT_YOLO|AGENT_COMPRESS_SEMANTIC|AGENT_LENGTH_RESUME_MAX|AGENT_FINALIZE_HINT|AGENT_FINALIZE_CITE|AGENT_CRITIC_REQUIRE|AGENT_REFLEXION_SEMANTIC|AGENT_OVERINFERENCE_GUARD|AGENT_VAULT_DEDUPE|AGENT_VAULT_REQUIRE_LINKS|AGENT_AUTO_DREAM|AGENT_AUTO_DREAM_ALLOW_DELETE|AGENT_RETRY_FOREVER|AGENT_MEMORY_DEBIAS|AGENT_MEMORY_EXPLORATORY_AUTO_RECALL|AGENT_MEMORY_INTROSPECTION_STRICT|AGENT_OVERINFERENCE_LLM_CHECK|AGENT_PASTE|AGENT_MARKETS_ENABLE|AGENT_WEB_FETCH_403_RETRY|AGENT_GOLDEN_EVAL|AGENT_HEARTBEAT|AGENT_HEARTBEAT_UI_STRIP|AGENT_FAILURE_DIGEST|AGENT_RECIPE_LIBRARY|AGENT_PROCESS_HEALTH|AGENT_INTENT_INFERENCE|AGENT_INTENT_REPO_CONTEXT|AGENT_OBSIDIAN_DISCOVER|AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN|AGENT_RULE_RECALL)$/.test(
      key
    )
  ) {
    return { valueKind: "boolean" };
  }
  return { valueKind: "string" };
}

const desc = (key, tab) =>
  `Harness environment toggle for ${titleCase(key)}. See docs/configuration.md (${tab.replace("_", " ")}).`;

const lines = [];
lines.push(`/**
 * UI metadata for every {@link HARNESS_MANAGED_ENV_KEYS} entry (web Settings modal).
 * Generated by scripts/gen-harness-settings-meta.mjs — re-run after inventory changes.
 */
import { HARNESS_MANAGED_ENV_KEYS } from "./harness_env_inventory.js";

export type HarnessSettingsTabId =
  | "models_api"
  | "session_ui"
  | "memory_vault"
  | "web_research"
  | "safety"
  | "documents"
  | "harness"
  | "advanced";

export type HarnessSettingsValueKind = "boolean" | "string" | "number" | "enum";

export interface HarnessSettingsFieldMeta {
  tabId: HarnessSettingsTabId;
  subgroupId: string;
  label: string;
  description: string;
  valueKind: HarnessSettingsValueKind;
  enumValues?: readonly string[];
  numericBounds?: { min?: number; max?: number; step?: number };
  sensitive?: boolean;
}

export type ManagedHarnessEnvKey = (typeof HARNESS_MANAGED_ENV_KEYS)[number];

/** Ordered tabs for the web settings UI. */
export const HARNESS_SETTINGS_TABS: { id: HarnessSettingsTabId; title: string }[] = [
  { id: "models_api", title: "Models & API" },
  { id: "session_ui", title: "Session & UI" },
  { id: "memory_vault", title: "Memory & vault" },
  { id: "web_research", title: "Web & markets" },
  { id: "safety", title: "Safety & approvals" },
  { id: "documents", title: "Documents" },
  { id: "harness", title: "Harness behavior" },
  { id: "advanced", title: "Advanced & telemetry" },
];

/** Human labels for subgroupId within a tab (fallback: title-case subgroupId). */
export const HARNESS_SETTINGS_SUBGROUP_LABELS: Record<
  HarnessSettingsTabId,
  Record<string, string>
> = {
  models_api: {
    routing: "Routing & primary models",
    vision: "Vision sidecar",
    memory_models: "Memory helper models",
    persona_models: "Persona generation",
    streaming: "Streaming & wall clocks",
    resilience: "Retries & circuit breaker",
  },
  session_ui: {
    session_ui: "Session surface",
    session_recording: "Session recording (JSONL)",
    heartbeat: "Personality heartbeat",
    auto_dream: "Auto dream consolidation",
  },
  memory_vault: {
    memory: "Memory features",
    retrieval: "Retrieval & recall",
    context_shaping: "Context shaping",
    vault_limits: "Vault writes",
    obsidian: "Obsidian discovery",
  },
  web_research: {
    features: "Web features",
    http_client: "HTTP fetch client",
    markets: "Markets quotes",
  },
  safety: { safety: "Safety gates" },
  documents: { documents: "Document engine" },
  harness: {
    tool_loading: "Tool loading",
    self_heal: "Self-heal lint",
    orchestration: "Orchestration",
    intent: "Intent inference",
    finalize: "Finalization",
    reflection: "Reflection & guards",
    critic: "Critic & verification",
    harness_misc: "Other harness",
  },
  advanced: {
    telemetry: "Logs & eval sinks",
    plugins: "Plugins & diagnostics",
  },
};

function subgroupLabel(tabId: HarnessSettingsTabId, subgroupId: string): string {
  return HARNESS_SETTINGS_SUBGROUP_LABELS[tabId]?.[subgroupId] ?? subgroupId.replace(/_/g, " ");
}

export function harnessSettingsSubgroupLabel(tabId: HarnessSettingsTabId, subgroupId: string): string {
  return subgroupLabel(tabId, subgroupId);
}

const _META_RAW: Record<string, HarnessSettingsFieldMeta> = {
`);

for (const key of keys) {
  const tab = tabFor(key);
  const subgroup = subgroupFor(key, tab);
  const kdef = kindFor(key);
  const label = titleCase(key);
  const description = desc(key, tab);
  const parts = [
    `  ${JSON.stringify(key)}: {`,
    `    tabId: ${JSON.stringify(tab)},`,
    `    subgroupId: ${JSON.stringify(subgroup)},`,
    `    label: ${JSON.stringify(label)},`,
    `    description: ${JSON.stringify(description)},`,
    `    valueKind: ${JSON.stringify(kdef.valueKind)},`,
  ];
  if (kdef.enumValues) parts.push(`    enumValues: ${JSON.stringify(kdef.enumValues)} as const,`);
  if (kdef.numericBounds && Object.keys(kdef.numericBounds).length)
    parts.push(`    numericBounds: ${JSON.stringify(kdef.numericBounds)},`);
  parts.push(`  },`);
  lines.push(parts.join("\n"));
}

lines.push(`};

export const HARNESS_SETTINGS_FIELD_META: Record<ManagedHarnessEnvKey, HarnessSettingsFieldMeta> =
  (() => {
    for (const k of HARNESS_MANAGED_ENV_KEYS) {
      const m = _META_RAW[k];
      if (!m) throw new Error(\`Missing harness settings field meta for \${k}\`);
    }
    return _META_RAW as Record<ManagedHarnessEnvKey, HarnessSettingsFieldMeta>;
  })();
`);

fs.writeFileSync("packages/core/src/harness_settings_field_meta.ts", lines.join("\n"));
console.log("Wrote", keys.length, "keys");
