import { HARNESS_MANAGED_ENV_KEYS } from "./harness_env_inventory.js";

const SECTION_META: Record<string, { title: string }> = {
  provider: { title: "Provider & models" },
  session: { title: "Session & UI" },
  memory: { title: "Memory & vault" },
  web: { title: "Web & fetch" },
  safety: { title: "Safety & approval" },
  doc: { title: "Document engine" },
  harness: { title: "Harness & orchestration" },
  debug: { title: "Debug & eval" },
};

function sectionIdForKey(key: string): keyof typeof SECTION_META {
  if (
    key === "AGENT_MODEL" ||
    key === "AGENT_API_BASE_URL" ||
    key === "AGENT_FAST_MODEL" ||
    key === "AGENT_EMBED_MODEL" ||
    key.startsWith("AGENT_VISION_MODEL") ||
    key.startsWith("AGENT_VISION_BASE_URL") ||
    key.startsWith("AGENT_VISION_TIMEOUT") ||
    key.startsWith("AGENT_VISION_MAX_IMAGE") ||
    key.startsWith("AGENT_VISION_RETR") ||
    key.startsWith("AGENT_VISION_RETRY") ||
    key === "AGENT_MEMORY_AUTOLINK_MODEL" ||
    key === "AGENT_MEMORY_CONSOLIDATE_MODEL" ||
    key === "AGENT_PERSONA_INFER_MODEL" ||
    key === "AGENT_PERSONA_GEN_TIMEOUT_MS" ||
    key === "AGENT_PERSONA_GEN_RETRIES"
  ) {
    return "provider";
  }
  if (
    key.includes("SESSION") ||
    key.includes("GREET") ||
    key.includes("PERSONA_BOOTSTRAP") ||
    key === "AGENT_UI_VERBOSITY" ||
    key === "AGENT_LOCATION" ||
    key === "AGENT_SESSION_MODE" ||
    key === "AGENT_SEND_TIMEOUT_MS" ||
    key === "AGENT_STREAM_CHUNK_TIMEOUT_MS" ||
    key === "AGENT_STREAM_MAX_RETRIES" ||
    key === "AGENT_COMPRESS_SEMANTIC" ||
    key === "AGENT_YIELD_EVERY_N" ||
    key === "AGENT_PASTE" ||
    key.startsWith("AGENT_AUTO_DREAM") ||
    key.startsWith("AGENT_HEARTBEAT")
  ) {
    return "session";
  }
  if (
    key.includes("MEMORY") ||
    key.includes("VAULT") ||
    key.startsWith("AGENT_OBSIDIAN") ||
    key.includes("RECALL") ||
    key.includes("QUERY_REWRITE") ||
    key.includes("SPECULATIVE_READS")
  ) {
    return "memory";
  }
  if (
    key.includes("WEB_") ||
    key === "AGENT_BROWSER" ||
    key === "AGENT_WEB_RESEARCH" ||
    key === "AGENT_WEB_READABILITY"
  ) {
    return "web";
  }
  if (
    key.includes("SAFETY") ||
    key.includes("APPROVAL") ||
    key === "AGENT_YOLO" ||
    key === "AGENT_RULE_RECALL"
  ) {
    return "safety";
  }
  if (key.includes("DOC_")) {
    return "doc";
  }
  if (
    key.includes("GOLDEN") ||
    key.includes("FAILURE") ||
    key.includes("EVAL_JSON") ||
    key.includes("RECIPE") ||
    key.includes("PROTOCOL_INTENT") ||
    key === "AGENT_CRITIC" ||
    key === "AGENT_CRITIC_EVIDENCE" ||
    key === "AGENT_FAILURE_LOG" ||
    key === "AGENT_PLUGIN_DIR" ||
    key === "AGENT_PROCESS_HEALTH" ||
    key === "AGENT_LINT_ALLOWED_COMMANDS"
  ) {
    return "debug";
  }
  return "harness";
}

const SECTION_ORDER: (keyof typeof SECTION_META)[] = [
  "provider",
  "session",
  "memory",
  "web",
  "safety",
  "doc",
  "harness",
  "debug",
];

/** Grouped keys for the web Settings modal (every {@link HARNESS_MANAGED_ENV_KEYS} entry appears once). */
export const HARNESS_SETTINGS_UI_SECTIONS: readonly {
  id: string;
  title: string;
  keys: readonly string[];
}[] = (() => {
  const buckets = new Map<string, string[]>();
  for (const id of SECTION_ORDER) {
    buckets.set(id, []);
  }
  for (const key of HARNESS_MANAGED_ENV_KEYS) {
    const id = sectionIdForKey(key);
    buckets.get(id)!.push(key);
  }
  return SECTION_ORDER.map((id) => ({
    id,
    title: SECTION_META[id].title,
    keys: buckets.get(id)!,
  }));
})();
