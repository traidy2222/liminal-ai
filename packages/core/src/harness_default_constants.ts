/**
 * Product default string values for `AGENT_*` keys when neither `process.env`
 * nor persisted `runtimePreferences.harness.env` set them.
 *
 * Two-tier model defaults:
 *   Main model  (AGENT_MODEL)      — full ReAct loop, tool orchestration, final answers
 *   Fast model  (AGENT_FAST_MODEL) — background tasks: intent routing, distillation,
 *                                    reflexion extraction, safety judge, context compression,
 *                                    query rewrite, memory extract, auto-dream, heartbeat
 *
 * Sidecar calls (recall-every-N, query rewrite, auto-extract, self-heal lint) are OFF by
 * default. Enable individually in Settings when the quality gain justifies the spend.
 */

/** OpenAI-compatible server root (`…/v1/chat/completions`). Default: OpenRouter cloud. */
export const DEFAULT_AGENT_API_BASE_URL = "https://openrouter.ai/api/v1";

/** Main model — full reasoning, tool use, final answers. */
export const DEFAULT_AGENT_MODEL_SLUG = "deepseek/deepseek-v4-pro";

/** Fast model — structured JSON tasks, classification, background extraction. */
export const DEFAULT_AGENT_FAST_MODEL_SLUG = "deepseek/deepseek-v4-flash";

export const HARNESS_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  AGENT_UI_VERBOSITY: "normal",
  AGENT_VAULT_AUTO_WRITE: "off",
  AGENT_APPROVAL_TIMEOUT_MS: "120000",
  AGENT_RATE_LIMIT_MAX_RETRIES: "8",
  AGENT_TRANSIENT_5XX_MAX_RETRIES: "8",
  AGENT_RETRY_MAX_DELAY_MS: "30000",
  AGENT_RETRY_WALL_TIME_MS: "90000",
  AGENT_PROVIDER_CIRCUIT_FAILURES: "3",
  AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS: "60000",
  /** OpenRouter free VL model (image in → text out). Provider key read from env. */
  AGENT_VISION_MODEL: "nvidia/nemotron-nano-12b-v2-vl:free",
  AGENT_VISION_BASE_URL: "https://openrouter.ai/api/v1",
  AGENT_VISION_TIMEOUT_MS: "45000",
  AGENT_VISION_MAX_IMAGE_BYTES: "4194304",
  AGENT_VISION_RETRIES: "2",
  AGENT_VISION_RETRY_BASE_MS: "800",
  AGENT_API_BASE_URL: DEFAULT_AGENT_API_BASE_URL,
  AGENT_MODEL: DEFAULT_AGENT_MODEL_SLUG,
  AGENT_FAST_MODEL: DEFAULT_AGENT_FAST_MODEL_SLUG,
  AGENT_SAFETY_JUDGE_MODEL: DEFAULT_AGENT_FAST_MODEL_SLUG,
  AGENT_EMBED_MODEL: "qwen/qwen3-embedding-8b",  // OpenRouter embedding model for hybrid BM25+vector recall; "" = BM25-only
  AGENT_SESSION_GREET: "0",
  AGENT_PERSONA_BOOTSTRAP: "1",
  AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP: "1",
  AGENT_PERSONA_INFER_MODEL: "",
  AGENT_PERSONA_GEN_TIMEOUT_MS: "90000",
  AGENT_PERSONA_GEN_RETRIES: "2",
  AGENT_PERSONA_UI_THEME_LLM: "1",
  AGENT_PERSONA_SOUL_MODE: "batch",
  AGENT_PERSONA_REPAIR_MAX: "1",
  AGENT_PERSONA_GENERATION_STREAM: "1",
  AGENT_PERSONA_PREVIEW_MAX_CHARS: "16000",
  AGENT_SESSION_JSONL: "1",
  AGENT_SESSION_JSONL_TEXT_LOG: "rollup",
  AGENT_SESSION_JSONL_MAX_ROLLUP_CHARS: "500000",
  AGENT_SESSION_JSONL_TRACE: "0",
  AGENT_TOOL_BODY_ELIDE: "1",
  AGENT_TOOL_ELIDE_MIN_CHARS: "10000",
  AGENT_TOOL_ELIDE_KEEP_ROUNDS: "3",
  AGENT_DISTILL: "1",
  AGENT_DISTILL_WEB_FETCH: "0",
  // Sidecar model calls — OFF by default (each fires a full completion at main-model cost).
  // Enable individually in .env when the quality gain justifies the spend.
  AGENT_RECALL_EVERY_N: "0",        // was "3": mid-turn recall every N rounds
  AGENT_SPECULATIVE_READS: "0",     // was "1": extra read_file calls on imports
  AGENT_QUERY_REWRITE: "0",         // was "1": multi-query expansion before recall
  AGENT_QUERY_REWRITE_EXPLORATORY: "0",
  AGENT_MEMORY_AUTO_EXTRACT: "0",   // was "1": end-of-turn extraction call
  AGENT_MEMORY_GRAPH: "1",
  AGENT_MEMORY_AUTOLINK: "0",
  AGENT_MEMORY_AUTOLINK_MODEL: DEFAULT_AGENT_FAST_MODEL_SLUG,
  AGENT_MEMORY_CONSOLIDATE_MODEL: DEFAULT_AGENT_FAST_MODEL_SLUG,
  AGENT_MEMORY_EPISODE: "0",
  AGENT_MEMORY_PRIME_ROUND0: "1",
  AGENT_TRAJECTORY_WRITE: "1",       // write causal trajectory: memory entries at turn end (zero LLM cost)
  AGENT_TOOL_LAZY: "1",
  AGENT_ALWAYS_TOOLS_PROFILE: "balanced",
  AGENT_SELF_HEAL_LINT: "0",        // was "1": lint repair rounds add extra tool iterations
  AGENT_SELF_HEAL_MAX_PASSES: "4",
  AGENT_SELF_HEAL_REPO_WIDE: "0",
  AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS: "1",
  AGENT_SELF_HEAL_LINT_MODE: "tsc",
  AGENT_SAFETY_JUDGE: "0",          // was "1": LLM single-token call on every approval gate
  AGENT_WEB_READABILITY: "1",
  AGENT_WEB_RESEARCH: "1",
  AGENT_WEB_FETCH_RETRIES: "2",
  AGENT_WEB_FETCH_TIMEOUT_MS: "20000",
  AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS: "6000",
  AGENT_WEB_FETCH_TOTAL_WALL_MS: "55000",
  AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS: "400000",
  AGENT_WEB_FETCH_READABILITY_MS: "12000",
  AGENT_WEB_FETCH_DEFAULT_MAX_CHARS: "32000",
  AGENT_WEB_FETCH_ASSETS_MAX_CHARS: "4000",
  AGENT_BROWSER: "1",
  AGENT_BROWSER_WALL_MS: "120000",
  AGENT_BROWSER_NAV_TIMEOUT_MS: "45000",
  AGENT_BROWSER_SESSION_TTL_MS: "120000",
  AGENT_BROWSER_MAX_SESSIONS: "2",
  AGENT_BROWSER_TYPE_DELAY_MS: "30",
  AGENT_BROWSER_ALWAYS_ACTIVE: "0",
  AGENT_BROWSER_STEALTH: "1",             // addInitScript patches + AutomationControlled disabled
  AGENT_BROWSER_USER_AGENT: "",           // empty = inherit AGENT_WEB_FETCH_USER_AGENT or Chrome 136 default
  AGENT_BROWSER_LOCALE: "en-US",
  AGENT_BROWSER_TIMEZONE: "",             // empty = auto-detect from system (Intl.DateTimeFormat)
  AGENT_BROWSER_CHROME_FULL_VERSION: "",  // empty = derive from major in UA (e.g. 136.0.0.0)
  AGENT_BROWSER_WEBGL_VENDOR: "",         // empty = "Google Inc. (Intel)"
  AGENT_BROWSER_WEBGL_RENDERER: "",       // empty = Intel UHD 630 ANGLE renderer string
  AGENT_DOC_ENGINE: "1",
  AGENT_DOC_AUTONOMY: "1",
  AGENT_DOC_WEB_ASSETS: "1",
  AGENT_DOC_QUALITY_MIN: "90",
  AGENT_DOC_REPAIR_BUDGET: "4",
  AGENT_DOC_MAX_SOURCE_LOOKUPS: "24",
  AGENT_DOC_STYLE_DIVERSITY_MIN: "0.12",
  AGENT_SEND_TIMEOUT_MS: "1800000",
  AGENT_STREAM_CHUNK_TIMEOUT_MS: "60000",
  AGENT_STREAM_MAX_RETRIES: "3",
  AGENT_FAILURE_LOG: "1",
  AGENT_CRITIC: "0",
  AGENT_CRITIC_EVIDENCE: "1",
  AGENT_EVAL_JSON_SINK: "1",
  AGENT_RULE_RECALL: "1",
  AGENT_COMPRESS_SEMANTIC: "0",
  AGENT_LENGTH_RESUME_MAX: "3",
  AGENT_MAX_COMPLETION_TOKENS: "4000",
  AGENT_WRITE_INTEGRITY_NUDGE: "1",
  AGENT_WRITE_PART_MAX_CHARS: "512000",
  AGENT_WRITE_STREAM_SINK: "0",
  AGENT_WRITE_STREAM_SINK_MIN_CHARS: "8000",
  AGENT_PSEUDO_TOOL_RETRY_MAX: "2",
  AGENT_FINALIZE_RETRY_BUDGET: "0",
  AGENT_FINALIZE_HINT: "0",
  AGENT_FINALIZE_CITE: "1",
  AGENT_CRITIC_MIN_TOOLS: "4",
  AGENT_CRITIC_REQUIRE: "0",
  AGENT_CRITIC_MODE: "single",
  AGENT_REFLEXION_SEMANTIC: "1",
  AGENT_OVERINFERENCE_GUARD: "1",
  AGENT_MIN_CONCURRENT_AGENTS: "1",
  AGENT_CONCURRENCY_COOLDOWN_MS: "60000",
  AGENT_YIELD_EVERY_N: "0",
  AGENT_VAULT_WRITE_BUDGET: "8",
  AGENT_VAULT_DEDUPE: "1",
  AGENT_VAULT_REQUIRE_LINKS: "0",
  AGENT_OBSIDIAN_DISCOVER: "1",
  AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN: "1",
  AGENT_AUTO_DREAM: "0",
  AGENT_AUTO_DREAM_INJECT_TRANSCRIPT: "1",
  AGENT_AUTO_DREAM_ALLOW_DELETE: "0",
  AGENT_RETRY_FOREVER: "0",
  AGENT_INTENT_CONFIDENCE_MIN: "0.65",
  AGENT_INTENT_INFERENCE: "1",      // LLM-only classification — no keyword/regex fallback
  AGENT_INTENT_INFERENCE_TIMEOUT_MS: "8000", // abort if model stalls; falls back to neutral
  AGENT_INTENT_REPO_CONTEXT: "0",
  AGENT_INTENT_CONTEXT_MAX_CHARS: "12000",
  AGENT_MEMORY_DEBIAS: "1",
  AGENT_MEMORY_EXPLORATORY_AUTO_RECALL: "0",
  AGENT_MEMORY_MAX_AGE_DAYS_DEFAULT: "540",
  AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT: "0.35",
  AGENT_MEMORY_INTROSPECTION_STRICT: "0",
  AGENT_OVERINFERENCE_LLM_CHECK: "0", // was "1": LLM over-inference classifier call
  AGENT_PASTE: "0",
  AGENT_MARKETS_ENABLE: "1",
  AGENT_MARKETS_TIMEOUT_MS: "8000",
  AGENT_MARKETS_RETRIES: "2",
  AGENT_MARKETS_MAX_DELAY_MS: "2000",
  AGENT_WEB_FETCH_403_RETRY: "1",
  AGENT_PROVIDER_MIN_INTERVAL_MS: "0",
  // Provider pinning — OpenRouter sticky cache affinity
  AGENT_PROVIDER_ROUTE_AUTO: "1",          // auto-derive provider order from model slug prefix
  AGENT_PROVIDER_ORDER: "",                // comma-separated override for main model: "AtlasCloud,NovitaAI,GMICloud"
  AGENT_PROVIDER_ORDER_FAST: "",           // comma-separated override for fast/sidecar model: "AtlasCloud,NovitaAI,SiliconFlow"
  AGENT_PROVIDER_ALLOW_FALLBACKS: "1",     // allow fallback if preferred provider unavailable
  AGENT_GOLDEN_EVAL: "1",
  AGENT_FAILURE_DIGEST: "1",
  AGENT_RECIPE_LIBRARY: "1",
  AGENT_YOLO: "0",
  AGENT_AUTO_DREAM_MIN_HOURS: "24",
  AGENT_AUTO_DREAM_MIN_SESSIONS: "5",
  AGENT_AUTO_DREAM_SCAN_INTERVAL_MS: "600000",
  AGENT_AUTO_DREAM_MAX_SESSION_FILES: "8",
  AGENT_AUTO_DREAM_MAX_CHARS_PER_SESSION: "10000",
  AGENT_AUTO_DREAM_MAX_TOTAL_CHARS: "40000",
  AGENT_AUTO_DREAM_LOCK_STALE_MS: "3600000",
  AGENT_PROTOCOL_INTENT_HINT: "any",
  AGENT_PLUGIN_DIR: "",
  AGENT_PROCESS_HEALTH: "0",
  AGENT_LINT_ALLOWED_COMMANDS: "",
  // CAPTCHA solving (2captcha / CapSolver) — key stays in .env only
  AGENT_CAPTCHA_SERVICE: "2captcha",   // "2captcha" | "capsolver"
  AGENT_CAPTCHA_TIMEOUT_MS: "120000", // max wait for human solver
  AGENT_CAPTCHA_POLL_MS: "3000",      // polling interval
  // Phase 1 — Adaptive Intelligence
  // Adaptive context routing by turn intent
  AGENT_INTENT_ROUTING: "1",           // on: routes knowledge/introspection turns to fast model
  AGENT_INTENT_FAST_THRESHOLD: "0.8",  // min confidence to route to fast model
  AGENT_INTENT_OPERATIONAL_MODEL: "",  // empty = use AGENT_FAST_MODEL
  // Adaptive reasoning budget (merged into intent inference fast call)
  AGENT_REASONING_BUDGET: "1",           // on: use classifier reasoningEffort/thinkDepth fields
  AGENT_REASONING_DEFAULT_EFFORT: "high", // fallback when classifier off or low confidence
  AGENT_EFFORT_LEARN: "1",               // record per-intent effort outcomes and reuse the best as fallback prior
  AGENT_REASONING_NUDGE_CHARS: "2500",   // legacy; stream stall enforcement removed
  AGENT_REASONING_SURFACE: "external",   // native | external | auto — always external: model uses think()+reason() tools
  AGENT_REASONING_NATIVE_SLUGS: "",      // unused by default; set to re-enable native stream for specific slugs
  AGENT_REASONING_EXTERNAL_SLUGS: "",    // comma substrings → force external (think-primary)
  // Tiered context preservation
  AGENT_CTX_HOT_ROUNDS: "4",          // verbatim rounds kept
  AGENT_CTX_WARM_ROUNDS: "8",         // rounds kept as tier-2 provenance blocks
  AGENT_CTX_PROVENANCE: "1",          // write provenance artifacts for warm/cold blocks
  // Semantic dream gating
  AGENT_DREAM_THRESHOLD: "0.15",      // min BM25 score to trigger auto-recall
  AGENT_DREAM_CONTRADICT_CONFIDENCE: "0.85", // confidence required for auto-resolution
  AGENT_DREAM_CONTRADICT_AUTO_RESOLVE: "1",  // auto-update stale notes on contradiction
  // Compensation ledger
  AGENT_COMPENSATION_ENABLED: "1",    // track and replay plan side-effect compensations
  AGENT_COMPENSATION_MAX_ACTIONS: "32", // max compensation entries per plan
  // Closed-loop self-tuning — auto-demote rules with consistently low avg outcome
  AGENT_RULE_DEMOTE_THRESHOLD: "0.4",   // rules below this avg_outcome get demoted
  AGENT_RULE_DEMOTE_MIN_SAMPLES: "20",  // minimum sample size before demotion can fire
};
