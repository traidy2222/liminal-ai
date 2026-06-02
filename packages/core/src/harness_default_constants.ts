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
  /** Audio transcription — defaults to cheapest viable model (Whisper Large V3 Turbo @ $0.04/hour). */
  AGENT_TRANSCRIBE_ENABLED: "1",
  AGENT_TRANSCRIBE_MODEL: "openai/whisper-large-v3-turbo",
  AGENT_TRANSCRIBE_BASE_URL: "https://openrouter.ai/api/v1",
  AGENT_TRANSCRIBE_MAX_BYTES: "26214400", // 25 MB, matches Whisper-1 historical cap
  AGENT_TRANSCRIBE_TIMEOUT_MS: "120000",
  AGENT_TRANSCRIBE_AUTO_ON_UPLOAD: "1",
  AGENT_TRANSCRIBE_TIMESTAMPS: "segment",
  /** Text-to-speech — off by default; web-only playback in v1. */
  AGENT_TTS_ENABLED: "0",
  AGENT_TTS_MODEL: "hexgrad/kokoro-82m",
  AGENT_TTS_VOICE: "af_sky",
  AGENT_TTS_BASE_URL: "https://openrouter.ai/api/v1",
  AGENT_TTS_TIMEOUT_MS: "45000",
  AGENT_TTS_MAX_CHARS_PER_CALL: "4096",
  AGENT_TTS_MAX_OUTPUT_TOKENS: "4096",
  AGENT_TTS_CHUNK_CHARS: "400",
  AGENT_TTS_MAX_CALLS_PER_TURN: "8",
  AGENT_TTS_MIN_INTERVAL_MS: "800",
  AGENT_TTS_RESPONSE_FORMAT: "mp3",
  AGENT_DICTATION_AUDIO_CUE: "0",
  /** ms — minimum recording length before auto-send is considered (filters coughs). */
  AGENT_DICTATION_MIN_RECORDING_MS: "1500",
  /** ms — pause threshold for short utterances (< 5s recorded). Snappy. */
  AGENT_DICTATION_SILENCE_MS_SHORT: "1500",
  /** ms — pause threshold for longer recordings. More room for mid-thought pauses. */
  AGENT_DICTATION_SILENCE_MS_LONG: "2500",
  /** ms — hard cap on continuous recording (safety). */
  AGENT_DICTATION_MAX_RECORDING_MS: "60000",
  AGENT_API_BASE_URL: DEFAULT_AGENT_API_BASE_URL,
  /** byok | managed | auto — auto uses managed when entitled; with PREFER_MANAGED, also when a local API key exists. */
  AGENT_INFERENCE_MODE: "auto",
  /** When 1, auto mode uses Vireon managed inference for entitled Pro+ even if AGENT_API_KEY is set. */
  AGENT_INFERENCE_PREFER_MANAGED: "1",
  AGENT_INFERENCE_BASE_URL: "https://api.vireondynamics.com/v1/inference",
  AGENT_INFERENCE_SESSION_URL: "https://www.vireondynamics.com/api/inference/session",
  AGENT_INFERENCE_SESSION_TOKEN: "",
  /** Marketing site origin for `liminal login` / connect flow (override for staging). */
  AGENT_VIREON_SITE_URL: "https://www.vireondynamics.com",
  AGENT_LICENSE_PREFER_ENV: "0",
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
  AGENT_TOOL_BODY_ELIDE: "0",
  AGENT_TOOL_ELIDE_MIN_CHARS: "12000",    // for coding workflows: keep file/grep results readable. Lower (e.g. 5000) only for chat-style tasks where verbatim tool output matters less.
  // read_file distillation — OFF by default. Distilling source files replaces
  // code with bullet-point JSON summaries, which forces the model to re-read
  // constantly. Enable only for workflows that primarily summarize huge files.
  AGENT_DISTILL_READ_FILE: "0",
  AGENT_TOOL_ELIDE_KEEP_ROUNDS: "3",
  AGENT_DISTILL: "0",
  AGENT_DISTILL_WEB_FETCH: "0",
  // Sidecar model calls — OFF by default (each fires a full completion at main-model cost).
  // Enable individually in .env when the quality gain justifies the spend.
  AGENT_RECALL_EVERY_N: "0",        // was "3": mid-turn recall every N rounds
  AGENT_SPECULATIVE_READS: "0",     // was "1": extra read_file calls on imports
  AGENT_QUERY_REWRITE: "0",         // was "1": multi-query expansion before recall
  AGENT_QUERY_REWRITE_EXPLORATORY: "0",
  AGENT_RECALL_RERANK: "0",         // fast-model cross-encoder rerank over fused recall candidates (sidecar call)
  AGENT_RECALL_RERANK_WEIGHT: "1.0", // blend weight: finalScore = hybrid * (1 + weight * relevance)
  // LLM JSON response cache — in-process LRU for fast-model JSON sidecar calls
  // (intent/distill/rewrite/critic/rerank). Pure optimization; ON by default.
  AGENT_LLM_JSON_CACHE: "1",
  AGENT_LLM_JSON_CACHE_TTL_MS: "300000",
  AGENT_MEMORY_AUTO_EXTRACT: "0",   // was "1": end-of-turn extraction call
  AGENT_MEMORY_GRAPH: "1",
  AGENT_MEMORY_AUTOLINK: "0",
  AGENT_MEMORY_AUTOLINK_MODEL: "deepseek/deepseek-v4-pro",
  AGENT_MEMORY_CONSOLIDATE_MODEL: "deepseek/deepseek-v4-pro",
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
  /** Default run_shell wall clock when the model omits timeout_ms. */
  AGENT_SHELL_TIMEOUT_MS: "60000",
  /** Max run_shell when the model passes explicit timeout_ms (0 = no cap). */
  AGENT_SHELL_MAX_TIMEOUT_MS: "3600000",
  /** Max when timeout_ms is omitted — stops accidental multi-minute one-liners. */
  AGENT_SHELL_IMPLICIT_MAX_MS: "180000",
  AGENT_STREAM_CHUNK_TIMEOUT_MS: "60000",
  AGENT_STREAM_MAX_RETRIES: "3",
  AGENT_FAILURE_LOG: "1",
  AGENT_CRITIC: "0",
  AGENT_CRITIC_EVIDENCE: "1",
  AGENT_EVAL_JSON_SINK: "1",
  AGENT_RULE_RECALL: "1",
  AGENT_COMPRESS_SEMANTIC: "0",
  AGENT_LENGTH_RESUME_MAX: "8",
  AGENT_MAX_COMPLETION_TOKENS: "16000",
  AGENT_WRITE_INTEGRITY_NUDGE: "1",
  AGENT_WRITE_PART_MAX_CHARS: "512000",
  AGENT_WRITE_STREAM_SINK: "1",
  AGENT_WRITE_STREAM_SINK_MIN_CHARS: "8000",
  AGENT_PSEUDO_TOOL_RETRY_MAX: "2",
  AGENT_FINALIZE_RETRY_BUDGET: "0",
  AGENT_FINALIZE_HINT: "0",
  AGENT_FINALIZE_CITE: "0",
  AGENT_FINALIZE_JUDGE: "0",
  AGENT_CRITIC_MIN_TOOLS: "4",
  AGENT_CRITIC_REQUIRE: "0",
  AGENT_CRITIC_MODE: "single",
  AGENT_REFLEXION_SEMANTIC: "1",
  AGENT_OVERINFERENCE_GUARD: "1",
  AGENT_MIN_CONCURRENT_AGENTS: "1",
  AGENT_CONCURRENCY_COOLDOWN_MS: "60000",
  AGENT_YIELD_EVERY_N: "0",
  AGENT_VAULT_WRITE_BUDGET: "8",
  AGENT_VAULT_DEDUPE: "0",
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
  AGENT_PASTE_PREDICTIVE: "0",
  AGENT_PASTE_BUDGET_MS: "2000",
  AGENT_PASTE_MIN_PROB: "0.5",
  AGENT_PASTE_CONTEXT_WINDOW: "2",
  AGENT_PASTE_MAX_CONCURRENT: "2",
  AGENT_MARKETS_ENABLE: "1",
  AGENT_MARKETS_TIMEOUT_MS: "8000",
  AGENT_MARKETS_RETRIES: "2",
  AGENT_MARKETS_MAX_DELAY_MS: "2000",
  AGENT_WEB_FETCH_403_RETRY: "1",
  AGENT_PROVIDER_MIN_INTERVAL_MS: "0",
  // Provider routing — adaptive price sort + session_id stickiness (OpenRouter-native cache affinity).
  // Use AGENT_PROVIDER_STRATEGY=cache_first + AGENT_PROVIDER_ORDER=DeepInfra to restore explicit pin.
  AGENT_PROVIDER_STRATEGY: "price",          // live benchmark winner for cost+cache (see scripts/benchmark-provider-strategies.mjs)
  AGENT_PROVIDER_SORT: "price",            // override sort axis when strategy is adaptive or price
  AGENT_PROVIDER_ROUTE_AUTO: "1",          // auto-derive provider order from model slug (cache_first only, when ORDER empty)
  AGENT_PROVIDER_ORDER: "",                // cache_first: pin order; adaptive/price: optional allowlist (OpenRouter `only`)
  AGENT_PROVIDER_ORDER_FAST: "",           // fast-tier variant of AGENT_PROVIDER_ORDER
  AGENT_PROVIDER_ALLOW_FALLBACKS: "1",     // cache_first: allow backup resellers; adaptive always enables fallbacks
  AGENT_PROVIDER_IGNORE: "",               // static comma-separated denylist merged with dynamic 429 ignores
  AGENT_PROVIDER_MAX_PRICE_PROMPT: "",     // OpenRouter max_price.prompt cap (empty = no cap)
  AGENT_PROVIDER_MAX_PRICE_COMPLETION: "", // OpenRouter max_price.completion cap (empty = no cap)
  AGENT_PROVIDER_SESSION_EPOCH_ON_429: "1", // bump session_id epoch on 429 in adaptive mode to re-bind sticky routing
  /** Pass OpenRouter `session_id` (and aligned `user`) on chat completions for dashboard session grouping. */
  AGENT_OPENROUTER_SESSIONS: "1",
  /** Optional fixed session id override (else harness taskId / active chat id). Max 256 chars. */
  AGENT_OPENROUTER_SESSION_ID: "",
  // Prompt caching — adds cache_control breakpoint on the trailing static system
  // message. On DeepInfra/GMICloud/NovitaAI this discounts cached prefix tokens
  // ~10× on rounds 2+ of a ReAct turn. Disable only for A/B baseline measurement.
  AGENT_PROMPT_CACHE: "1",
  // Second, rolling cache_control breakpoint on the last stable conversation
  // message (after the volatile working/execution-state tail). Lets the prompt
  // cache extend across the growing tool-result history, not just the static
  // prefix — the dominant token cost in long ReAct turns. Most effective with
  // AGENT_CTX_VOLATILE_TAIL on. Set 0 to keep prefix-only caching.
  AGENT_PROMPT_CACHE_ROLLING: "1",
  AGENT_GOLDEN_EVAL: "1",
  AGENT_FAILURE_DIGEST: "1",
  AGENT_RECIPE_LIBRARY: "1",
  AGENT_YOLO: "0",
  AGENT_AUTO_DREAM_MIN_HOURS: "5",
  AGENT_AUTO_DREAM_MIN_SESSIONS: "10",
  AGENT_AUTO_DREAM_SCAN_INTERVAL_MS: "30000",
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
  AGENT_INTENT_FAST_THRESHOLD: "0.6",  // min confidence to route to fast model (lowered from 0.8 — Pro is ~13× more expensive than Flash; bias toward Flash on knowledge/introspection turns)
  AGENT_INTENT_OPERATIONAL_MODEL: "",  // empty = use AGENT_FAST_MODEL
  // Adaptive reasoning budget (merged into intent inference fast call)
  AGENT_REASONING_BUDGET: "1",           // on: use classifier reasoningEffort/thinkDepth fields
  AGENT_REASONING_DEFAULT_EFFORT: "high", // fallback when classifier off or low confidence
  AGENT_EFFORT_LEARN: "1",               // record per-intent effort outcomes and reuse the best as fallback prior
  AGENT_REASONING_NUDGE_CHARS: "2500",   // legacy; stream stall enforcement removed
  AGENT_REASONING_SURFACE: "external",   // native | external | auto — always external: model uses think()+reason() tools
  // Output-effort dial — SEPARATE axis from reasoning above. Governs how thorough
  // the DELIVERABLE is (completeness, edge cases, polish) via a system-prompt block.
  AGENT_EFFORT: "medium",                // low | medium | high | xhigh — deliverable thoroughness
  AGENT_REASONING_NATIVE_SLUGS: "",      // unused by default; set to re-enable native stream for specific slugs
  AGENT_REASONING_EXTERNAL_SLUGS: "",    // comma substrings → force external (think-primary)
  // Tiered context preservation
  AGENT_CTX_HOT_ROUNDS: "4",          // verbatim rounds kept
  AGENT_CTX_WARM_ROUNDS: "8",         // rounds kept as tier-2 provenance blocks
  AGENT_CTX_PROVENANCE: "1",          // write provenance artifacts for warm/cold blocks
  // Place volatile working/execution-state system blocks AFTER the conversation
  // history (vs. between inception and history). Keeps the [inception, ...stable
  // history] prefix byte-identical round-to-round so prompt caching can extend
  // across it. Set 0 to restore the legacy (volatile-in-the-middle) ordering.
  AGENT_CTX_VOLATILE_TAIL: "1",
  // Semantic dream gating
  AGENT_DREAM_THRESHOLD: "0.15",      // min BM25 score to trigger auto-recall
  AGENT_DREAM_CONTRADICT_CONFIDENCE: "0.85", // confidence required for auto-resolution
  AGENT_DREAM_CONTRADICT_AUTO_RESOLVE: "1",  // auto-update stale notes on contradiction
  // Memory curator (LLM-driven note pruning + reversible soft-delete archive)
  AGENT_MEMORY_ARCHIVE: "1",          // forget/curate soft-delete into notes.archive.json before removing
  AGENT_MEMORY_ARCHIVE_MAX: "2000",   // archive ring-buffer cap (oldest trimmed past this)
  AGENT_MEMORY_CURATOR_MODEL: "",     // optional model slug for curate_memory (default: fast model)
  AGENT_CURATOR_TIMEOUT_MS: "90000",  // wall-clock budget for the curate_memory model call (clamped 5s–300s)
  AGENT_CURATOR_MAX_TOKENS: "6000",   // output budget for the curate_memory plan JSON (clamped 1k–16k)
  AGENT_CURATOR_PROTECT_GLOBAL: "0",  // when 1, also veto every scope:global note (off — global is the default scope, not a durability signal)
  AGENT_CURATOR_PROTECT_ACCESS_COUNT: "3",   // never prune notes accessed >= this many times
  AGENT_CURATOR_PROTECT_MIN_AGE_HOURS: "24", // never prune notes younger than this (by createdAt)
  AGENT_MEMORY_MAX_NOTES: "0",        // reserved: future budget-triggered auto-curation (0 = off)
  // Dynamic workflows (ultracode-equivalent) — multi-phase sub-agent fan-out
  // with results kept out of the parent context.
  AGENT_WORKFLOWS: "1",               // master switch for plan_workflow/run_workflow tools
  AGENT_WORKFLOW_MAX_CONCURRENT: "4",  // max concurrent sub-agents per phase wave
  AGENT_WORKFLOW_MAX_AGENTS: "64",     // total sub-agent cap per workflow run
  AGENT_WORKFLOW_TIMEOUT_MS: "1800000",// wall-clock cap for one workflow run
  AGENT_WORKFLOW_MODEL: "",            // optional planner/summarizer model (empty = fast model)
  AGENT_SPAWN_TOOL_INFER: "1",         // fast-model tool pick for sub-agents before first send
  AGENT_SPAWN_TOOL_INFER_MODEL: "",    // optional infer model (empty = AGENT_FAST_MODEL)
  AGENT_SPAWN_TOOL_INFER_TIMEOUT_MS: "8000",
  // Compensation ledger
  AGENT_COMPENSATION_ENABLED: "1",    // track and replay plan side-effect compensations
  AGENT_COMPENSATION_MAX_ACTIONS: "32", // max compensation entries per plan
  // Optional / inherit-when-empty (Settings UI shows product default instead of blank)
  AGENT_VAULT_PATH: "",
  AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING: "",
  AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS: "72000",
  AGENT_WEB_FETCH_ACCEPT_LANGUAGE: "",
  AGENT_WEB_FETCH_SEC_CH_PLATFORM: "",
  AGENT_WEB_FETCH_USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  AGENT_WEB_FETCH_ALT_USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
  AGENT_WEB_FETCH_REFERER: "",
  AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE: "",
  AGENT_BROWSER_FILE_ROOT: "",
  AGENT_BROWSER_ALLOW_FILE_ANY: "0",
  AGENT_BROWSER_HEADED: "0",
  AGENT_BROWSER_AUTO_VISION: "0",
  AGENT_SESSION_MODE: "",
  AGENT_LOCATION: "",
  AGENT_UPSTREAM_429_SUGGESTED_WAIT_MS: "",
  AGENT_HEARTBEAT: "0",
  AGENT_HEARTBEAT_IDLE_MS: "45000",
  AGENT_HEARTBEAT_MAX_TOKENS: "512",
  AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR: "2",
  AGENT_HEARTBEAT_MIN_INTERVAL_MS: "120000",
  AGENT_HEARTBEAT_SURFACE: "trace",
  AGENT_HEARTBEAT_TIMEOUT_MS: "20000",
  AGENT_HEARTBEAT_UI_STRIP: "0",
  AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN: "0.86",
  // Closed-loop self-tuning — auto-demote rules with consistently low avg outcome
  AGENT_RULE_DEMOTE_THRESHOLD: "0.4",   // rules below this avg_outcome get demoted
  AGENT_RULE_DEMOTE_MIN_SAMPLES: "20",  // minimum sample size before demotion can fire
};
