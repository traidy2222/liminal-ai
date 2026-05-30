# Environment reference

> **Generated** by `npm run docs:gen` from `harness_env_inventory.ts`,
> `harness_default_constants.ts`, and `harness_settings_field_meta.ts`.
> Do not edit by hand.

## Precedence

1. `process.env` / `.env` (secrets and deploy overrides)
2. `.agent_runtime_prefs.json` → `harness.env`
3. `HARNESS_ENV_DEFAULTS` in `packages/core/src/harness_default_constants.ts`

Web **Settings** writes to (2). See [Configuration basics](../start/configuration-basics.md).

## Managed keys

| Key | Default | Settings | Secret | Tab | Description |
|-----|---------|----------|--------|-----|-------------|
| `AGENT_ALWAYS_TOOLS_PROFILE` | `balanced` | yes | no | harness | Harness environment toggle for Always Tools Profile. See docs/configuration.md (harness). |
| `AGENT_API_BASE_URL` | `https://openrouter.ai/api/v1` | yes | no | models_api | Harness environment toggle for Api Base Url. See docs/configuration.md (models api). |
| `AGENT_APPROVAL_TIMEOUT_MS` | `120000` | yes | yes | safety | Harness environment toggle for Approval Timeout Ms. See docs/configuration.md (safety). |
| `AGENT_AUTO_DREAM` | `0` | yes | no | session_ui | Harness environment toggle for Auto Dream. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_ALLOW_DELETE` | `0` | yes | no | session_ui | Harness environment toggle for Auto Dream Allow Delete. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_INJECT_TRANSCRIPT` | `1` | yes | no | session_ui | Harness environment toggle for Auto Dream Inject Transcript. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_LOCK_STALE_MS` | `3600000` | yes | no | session_ui | Harness environment toggle for Auto Dream Lock Stale Ms. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_CHARS_PER_SESSION` | `10000` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Chars Per Session. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_SESSION_FILES` | `8` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Session Files. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_TOTAL_CHARS` | `40000` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Total Chars. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MIN_HOURS` | `5` | yes | no | session_ui | Harness environment toggle for Auto Dream Min Hours. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MIN_SESSIONS` | `10` | yes | no | session_ui | Harness environment toggle for Auto Dream Min Sessions. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_SCAN_INTERVAL_MS` | `30000` | yes | no | session_ui | Harness environment toggle for Auto Dream Scan Interval Ms. See docs/configuration.md (session ui). |
| `AGENT_BROWSER` | `1` | yes | no | web_research | Harness environment toggle for Browser. See docs/configuration.md (web research). |
| `AGENT_BROWSER_ALLOW_FILE_ANY` | `0` | yes | no | harness | Harness environment toggle for Browser Allow File Any. See docs/configuration.md (harness). |
| `AGENT_BROWSER_ALWAYS_ACTIVE` | `0` | yes | no | harness | Harness environment toggle for Browser Always Active. See docs/configuration.md (harness). |
| `AGENT_BROWSER_AUTO_VISION` | `0` | yes | no | harness | Harness environment toggle for Browser Auto Vision. See docs/configuration.md (harness). |
| `AGENT_BROWSER_FILE_ROOT` | `` | yes | no | harness | Harness environment toggle for Browser File Root. See docs/configuration.md (harness). |
| `AGENT_BROWSER_HEADED` | `0` | yes | no | harness | Harness environment toggle for Browser Headed. See docs/configuration.md (harness). |
| `AGENT_BROWSER_MAX_SESSIONS` | `2` | yes | no | session_ui | Harness environment toggle for Browser Max Sessions. See docs/configuration.md (session ui). |
| `AGENT_BROWSER_NAV_TIMEOUT_MS` | `45000` | yes | no | harness | Harness environment toggle for Browser Nav Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_BROWSER_SESSION_TTL_MS` | `120000` | yes | no | session_ui | Harness environment toggle for Browser Session Ttl Ms. See docs/configuration.md (session ui). |
| `AGENT_BROWSER_TYPE_DELAY_MS` | `30` | yes | no | harness | Harness environment toggle for Browser Type Delay Ms. See docs/configuration.md (harness). |
| `AGENT_BROWSER_WALL_MS` | `120000` | yes | no | harness | Harness environment toggle for Browser Wall Ms. See docs/configuration.md (harness). |
| `AGENT_CAPTCHA_POLL_MS` | `3000` | yes | no | harness | Harness environment toggle for Captcha Poll Ms. See docs/configuration.md (harness). |
| `AGENT_CAPTCHA_SERVICE` | `2captcha` | yes | no | harness | Harness environment toggle for Captcha Service. See docs/configuration.md (harness). |
| `AGENT_CAPTCHA_TIMEOUT_MS` | `120000` | yes | no | harness | Harness environment toggle for Captcha Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_COMPENSATION_ENABLED` | `1` | yes | no | harness | Harness environment toggle for Compensation Enabled. See docs/configuration.md (harness). |
| `AGENT_COMPENSATION_MAX_ACTIONS` | `32` | yes | no | harness | Harness environment toggle for Compensation Max Actions. See docs/configuration.md (harness). |
| `AGENT_COMPRESS_SEMANTIC` | `0` | yes | no | session_ui | Harness environment toggle for Compress Semantic. See docs/configuration.md (session ui). |
| `AGENT_CONCURRENCY_COOLDOWN_MS` | `60000` | yes | no | harness | Harness environment toggle for Concurrency Cooldown Ms. See docs/configuration.md (harness). |
| `AGENT_CRITIC` | `0` | yes | no | harness | Harness environment toggle for Critic. See docs/configuration.md (harness). |
| `AGENT_CRITIC_EVIDENCE` | `1` | yes | no | harness | Harness environment toggle for Critic Evidence. See docs/configuration.md (harness). |
| `AGENT_CRITIC_MIN_TOOLS` | `4` | yes | no | harness | Harness environment toggle for Critic Min Tools. See docs/configuration.md (harness). |
| `AGENT_CRITIC_MODE` | `single` | yes | no | harness | Harness environment toggle for Critic Mode. See docs/configuration.md (harness). |
| `AGENT_CRITIC_REQUIRE` | `0` | yes | no | harness | Harness environment toggle for Critic Require. See docs/configuration.md (harness). |
| `AGENT_CTX_HOT_ROUNDS` | `4` | yes | no | harness | Harness environment toggle for Ctx Hot Rounds. See docs/configuration.md (harness). |
| `AGENT_CTX_PROVENANCE` | `1` | yes | no | harness | Harness environment toggle for Ctx Provenance. See docs/configuration.md (harness). |
| `AGENT_CTX_VOLATILE_TAIL` | `1` | yes | no | harness | Place volatile working/execution-state system blocks AFTER the conversation history instead of between the static prefix |
| `AGENT_CTX_WARM_ROUNDS` | `8` | yes | no | harness | Harness environment toggle for Ctx Warm Rounds. See docs/configuration.md (harness). |
| `AGENT_CURATOR_MAX_TOKENS` | `6000` | yes | no | harness | Output token budget for the curate_memory plan JSON (clamped 1k–16k). Prevents the plan being truncated mid-JSON. |
| `AGENT_CURATOR_PROTECT_ACCESS_COUNT` | `3` | yes | no | harness | Memory curator never prunes notes accessed at least this many times. |
| `AGENT_CURATOR_PROTECT_GLOBAL` | `0` | yes | no | harness | When on, the memory curator also refuses to touch any global-scope note. Off by default — global is the fallback scope,  |
| `AGENT_CURATOR_PROTECT_MIN_AGE_HOURS` | `24` | yes | no | harness | Memory curator never prunes notes younger than this many hours. |
| `AGENT_CURATOR_TIMEOUT_MS` | `90000` | yes | no | harness | Wall-clock budget for the curate_memory model call (clamped 5s–300s). Raise for large note stores. |
| `AGENT_DICTATION_AUDIO_CUE` | `0` | yes | no | models_api | Play a brief 880Hz tone when auto-send fires so you know the message went out. |
| `AGENT_DICTATION_MAX_RECORDING_MS` | `60000` | yes | no | models_api | Hard cap on a single continuous recording (default 60000ms = 60s). |
| `AGENT_DICTATION_MIN_RECORDING_MS` | `1500` | yes | no | models_api | Minimum recording length before auto-send is considered (default 1500ms — filters out coughs). |
| `AGENT_DICTATION_SILENCE_MS_LONG` | `2500` | yes | no | models_api | Pause threshold for longer recordings. Default 2500ms — more room for mid-thought pauses. |
| `AGENT_DICTATION_SILENCE_MS_SHORT` | `1500` | yes | no | models_api | Pause threshold for short utterances (< 5s recorded). Default 1500ms — snappy. |
| `AGENT_DISTILL` | `0` | yes | no | memory_vault | Harness environment toggle for Distill. See docs/configuration.md (memory vault). |
| `AGENT_DISTILL_READ_FILE` | `0` | yes | no | memory_vault | When 0 (default), read_file output is always kept verbatim — critical for coding tasks where source code is the model's  |
| `AGENT_DISTILL_WEB_FETCH` | `0` | yes | no | memory_vault | When 0, web_fetch full text is kept in the tool result (recommended for research). When 1, large fetches are LLM-summari |
| `AGENT_DOC_AUTONOMY` | `1` | yes | no | documents | Harness environment toggle for Doc Autonomy. See docs/configuration.md (documents). |
| `AGENT_DOC_ENGINE` | `1` | yes | no | documents | Harness environment toggle for Doc Engine. See docs/configuration.md (documents). |
| `AGENT_DOC_MAX_SOURCE_LOOKUPS` | `24` | yes | no | documents | Harness environment toggle for Doc Max Source Lookups. See docs/configuration.md (documents). |
| `AGENT_DOC_QUALITY_MIN` | `90` | yes | no | documents | Harness environment toggle for Doc Quality Min. See docs/configuration.md (documents). |
| `AGENT_DOC_REPAIR_BUDGET` | `4` | yes | no | documents | Harness environment toggle for Doc Repair Budget. See docs/configuration.md (documents). |
| `AGENT_DOC_STYLE_DIVERSITY_MIN` | `0.12` | yes | no | documents | Harness environment toggle for Doc Style Diversity Min. See docs/configuration.md (documents). |
| `AGENT_DOC_WEB_ASSETS` | `1` | yes | no | web_research | Harness environment toggle for Doc Web Assets. See docs/configuration.md (web research). |
| `AGENT_DREAM_CONTRADICT_AUTO_RESOLVE` | `1` | yes | no | harness | Harness environment toggle for Dream Contradict Auto Resolve. See docs/configuration.md (harness). |
| `AGENT_DREAM_CONTRADICT_CONFIDENCE` | `0.85` | yes | no | harness | Harness environment toggle for Dream Contradict Confidence. See docs/configuration.md (harness). |
| `AGENT_DREAM_THRESHOLD` | `0.15` | yes | no | harness | Harness environment toggle for Dream Threshold. See docs/configuration.md (harness). |
| `AGENT_EFFORT` | `medium` | yes | no | harness | Deliverable-thoroughness dial: injected each turn beside the reasoning budget, scales completion max_tokens (0.75×–1.5×) |
| `AGENT_EMBED_MODEL` | `qwen/qwen3-embedding-8b` | yes | no | models_api | Harness environment toggle for Embed Model. See docs/configuration.md (models api). |
| `AGENT_EVAL_JSON_SINK` | `1` | yes | no | advanced | Harness environment toggle for Eval Json Sink. See docs/configuration.md (advanced). |
| `AGENT_FAILURE_DIGEST` | `1` | yes | no | advanced | Harness environment toggle for Failure Digest. See docs/configuration.md (advanced). |
| `AGENT_FAILURE_LOG` | `1` | yes | no | advanced | Harness environment toggle for Failure Log. See docs/configuration.md (advanced). |
| `AGENT_FAST_MODEL` | `deepseek/deepseek-v4-flash` | yes | no | models_api | Harness environment toggle for Fast Model. See docs/configuration.md (models api). |
| `AGENT_FINALIZE_CITE` | `0` | yes | no | harness | Harness environment toggle for Finalize Cite. See docs/configuration.md (harness). |
| `AGENT_FINALIZE_HINT` | `0` | yes | no | harness | Harness environment toggle for Finalize Hint. See docs/configuration.md (harness). |
| `AGENT_FINALIZE_JUDGE` | `0` | yes | no | harness | When on, a fast-model research completeness judge could run before turn end (off by default; post-assistant re-reply loo |
| `AGENT_FINALIZE_RETRY_BUDGET` | `0` | yes | no | harness | Harness environment toggle for Finalize Retry Budget. See docs/configuration.md (harness). |
| `AGENT_GOLDEN_EVAL` | `1` | yes | no | advanced | Harness environment toggle for Golden Eval. See docs/configuration.md (advanced). |
| `AGENT_HEARTBEAT` | `0` | yes | no | session_ui | Harness environment toggle for Heartbeat. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_IDLE_MS` | `45000` | yes | no | session_ui | Harness environment toggle for Heartbeat Idle Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MAX_TOKENS` | `512` | yes | no | session_ui | Harness environment toggle for Heartbeat Max Tokens. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR` | `2` | yes | no | session_ui | Harness environment toggle for Heartbeat Max User Nudges Per Hour. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MIN_INTERVAL_MS` | `120000` | yes | no | session_ui | Harness environment toggle for Heartbeat Min Interval Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_SURFACE` | `trace` | yes | no | session_ui | Harness environment toggle for Heartbeat Surface. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_TIMEOUT_MS` | `20000` | yes | no | session_ui | Harness environment toggle for Heartbeat Timeout Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_UI_STRIP` | `0` | yes | no | session_ui | Harness environment toggle for Heartbeat Ui Strip. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN` | `0.86` | yes | no | session_ui | Harness environment toggle for Heartbeat User Nudge Confidence Min. See docs/configuration.md (session ui). |
| `AGENT_INTENT_CONFIDENCE_MIN` | `0.65` | yes | no | harness | Harness environment toggle for Intent Confidence Min. See docs/configuration.md (harness). |
| `AGENT_INTENT_CONTEXT_MAX_CHARS` | `12000` | yes | no | harness | Harness environment toggle for Intent Context Max Chars. See docs/configuration.md (harness). |
| `AGENT_INTENT_FAST_THRESHOLD` | `0.6` | yes | no | harness | Harness environment toggle for Intent Fast Threshold. See docs/configuration.md (harness). |
| `AGENT_INTENT_INFERENCE` | `1` | yes | no | harness | Harness environment toggle for Intent Inference. See docs/configuration.md (harness). |
| `AGENT_INTENT_OPERATIONAL_MODEL` | `` | yes | no | harness | Harness environment toggle for Intent Operational Model. See docs/configuration.md (harness). |
| `AGENT_INTENT_REPO_CONTEXT` | `0` | yes | no | harness | Harness environment toggle for Intent Repo Context. See docs/configuration.md (harness). |
| `AGENT_INTENT_ROUTING` | `1` | yes | no | harness | Harness environment toggle for Intent Routing. See docs/configuration.md (harness). |
| `AGENT_LENGTH_RESUME_MAX` | `8` | yes | no | harness | Harness environment toggle for Length Resume Max. See docs/configuration.md (harness). |
| `AGENT_LINT_ALLOWED_COMMANDS` | `` | yes | no | advanced | Harness environment toggle for Lint Allowed Commands. See docs/configuration.md (advanced). |
| `AGENT_LLM_JSON_CACHE` | `1` | yes | no | harness | In-process LRU cache for fast-model JSON sidecar calls (intent/distill/rewrite/critic/rerank). On by default. See docs/c |
| `AGENT_LLM_JSON_CACHE_TTL_MS` | `300000` | yes | no | harness | Time-to-live for entries in the LLM JSON response cache, in milliseconds. See docs/configuration.md (harness). |
| `AGENT_LOCATION` | `` | yes | no | session_ui | Harness environment toggle for Location. See docs/configuration.md (session ui). |
| `AGENT_MARKETS_ENABLE` | `1` | yes | no | web_research | Harness environment toggle for Markets Enable. See docs/configuration.md (web research). |
| `AGENT_MARKETS_MAX_DELAY_MS` | `2000` | yes | no | web_research | Harness environment toggle for Markets Max Delay Ms. See docs/configuration.md (web research). |
| `AGENT_MARKETS_RETRIES` | `2` | yes | no | web_research | Harness environment toggle for Markets Retries. See docs/configuration.md (web research). |
| `AGENT_MARKETS_TIMEOUT_MS` | `8000` | yes | no | web_research | Harness environment toggle for Markets Timeout Ms. See docs/configuration.md (web research). |
| `AGENT_MAX_COMPLETION_TOKENS` | `16000` | yes | no | harness | Harness environment toggle for Max Completion Tokens. See docs/configuration.md (harness). |
| `AGENT_MEMORY_ARCHIVE` | `1` | yes | no | harness | Soft-delete forgotten/curated notes into notes.archive.json before removing them (reversible). |
| `AGENT_MEMORY_ARCHIVE_MAX` | `2000` | yes | no | harness | Cap on archived notes retained in notes.archive.json (oldest trimmed past this). |
| `AGENT_MEMORY_AUTOLINK` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Autolink. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_AUTOLINK_MODEL` | `deepseek/deepseek-v4-pro` | yes | no | models_api | Harness environment toggle for Memory Autolink Model. See docs/configuration.md (models api). |
| `AGENT_MEMORY_AUTO_EXTRACT` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Auto Extract. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_CONSOLIDATE_MODEL` | `deepseek/deepseek-v4-pro` | yes | no | models_api | Harness environment toggle for Memory Consolidate Model. See docs/configuration.md (models api). |
| `AGENT_MEMORY_CURATOR_MODEL` | `` | yes | no | harness | Optional model slug for the curate_memory tool. Empty = use the fast model. |
| `AGENT_MEMORY_DEBIAS` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Debias. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_EPISODE` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Episode. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Exploratory Auto Recall. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_GRAPH` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Graph. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_INTROSPECTION_STRICT` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Introspection Strict. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_MAX_AGE_DAYS_DEFAULT` | `540` | yes | no | memory_vault | Harness environment toggle for Memory Max Age Days Default. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_MAX_NOTES` | `0` | yes | no | harness | Reserved for future budget-triggered auto-curation (0 = off). |
| `AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT` | `0.35` | yes | no | memory_vault | Harness environment toggle for Memory Min Confidence Default. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_PRIME_ROUND0` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Prime Round0. See docs/configuration.md (memory vault). |
| `AGENT_MIN_CONCURRENT_AGENTS` | `1` | yes | no | harness | Harness environment toggle for Min Concurrent Agents. See docs/configuration.md (harness). |
| `AGENT_MODEL` | `deepseek/deepseek-v4-pro` | yes | no | models_api | Harness environment toggle for Model. See docs/configuration.md (models api). |
| `AGENT_OBSIDIAN_DISCOVER` | `1` | yes | no | memory_vault | Harness environment toggle for Obsidian Discover. See docs/configuration.md (memory vault). |
| `AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN` | `1` | yes | no | memory_vault | Harness environment toggle for Obsidian Require Dot Obsidian. See docs/configuration.md (memory vault). |
| `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING` | `` | yes | no | memory_vault | Harness environment toggle for Obsidian Vault Name Substring. See docs/configuration.md (memory vault). |
| `AGENT_OPENROUTER_SESSIONS` | `1` | yes | no | harness | When on (default), chat completions to OpenRouter include session_id (and aligned user) so generations group in the Open |
| `AGENT_OPENROUTER_SESSION_ID` | `` | yes | no | harness | Optional fixed OpenRouter session_id for all requests (max 256 chars). Leave empty to use each chat's harness taskId. |
| `AGENT_OVERINFERENCE_GUARD` | `1` | yes | no | harness | Harness environment toggle for Overinference Guard. See docs/configuration.md (harness). |
| `AGENT_OVERINFERENCE_LLM_CHECK` | `0` | yes | no | harness | Harness environment toggle for Overinference Llm Check. See docs/configuration.md (harness). |
| `AGENT_PASTE` | `0` | yes | no | session_ui | Harness environment toggle for Paste. See docs/configuration.md (session ui). |
| `AGENT_PASTE_BUDGET_MS` | `2000` | yes | no | session_ui | Aggregate in-flight wall-clock cap for predictive speculations. |
| `AGENT_PASTE_CONTEXT_WINDOW` | `2` | yes | no | session_ui | Number of trailing tool calls used as the pattern lookup key. |
| `AGENT_PASTE_MAX_CONCURRENT` | `2` | yes | no | session_ui | Hard cap on concurrent in-flight predictive speculations. |
| `AGENT_PASTE_MIN_PROB` | `0.5` | yes | no | session_ui | Minimum mined-pattern probability before a speculation is dispatched (0–1). |
| `AGENT_PASTE_PREDICTIVE` | `0` | yes | no | session_ui | Enable predictive speculative dispatch of the next tool call based on mined session patterns. |
| `AGENT_PERSONA_BOOTSTRAP` | `1` | yes | no | session_ui | Harness environment toggle for Persona Bootstrap. See docs/configuration.md (session ui). |
| `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` | `1` | yes | no | session_ui | Harness environment toggle for Persona Bootstrap Allow Skip. See docs/configuration.md (session ui). |
| `AGENT_PERSONA_GENERATION_STREAM` | `1` | yes | no | harness | Stream persona bootstrap artifacts to the UI (0 = off). |
| `AGENT_PERSONA_GEN_RETRIES` | `2` | yes | no | harness | Harness environment toggle for Persona Gen Retries. See docs/configuration.md (harness). |
| `AGENT_PERSONA_GEN_TIMEOUT_MS` | `90000` | yes | no | harness | Harness environment toggle for Persona Gen Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_PERSONA_INFER_MODEL` | `` | yes | no | models_api | Harness environment toggle for Persona Infer Model. See docs/configuration.md (models api). |
| `AGENT_PERSONA_PREVIEW_MAX_CHARS` | `16000` | yes | no | harness | Max characters per artifact panel in bootstrap SSE previews. |
| `AGENT_PERSONA_REPAIR_MAX` | `1` | yes | no | harness | Max profile repair LLM passes after draft (0–2, default 1). |
| `AGENT_PERSONA_SOUL_MODE` | `batch` | yes | no | harness | Soul generation: batch (one call), parallel (four calls), or scaffold (no LLM). |
| `AGENT_PERSONA_UI_THEME_LLM` | `1` | yes | no | harness | Set 1 to run an LLM pass for HUD colors/shell; default 0 uses fast heuristics only. |
| `AGENT_PLUGIN_DIR` | `` | yes | no | advanced | Harness environment toggle for Plugin Dir. See docs/configuration.md (advanced). |
| `AGENT_PROCESS_HEALTH` | `0` | yes | no | advanced | Harness environment toggle for Process Health. See docs/configuration.md (advanced). |
| `AGENT_PROMPT_CACHE` | `1` | yes | no | harness | Add OpenRouter cache_control breakpoints to the static system prefix. On cache-supporting providers (DeepInfra, GMICloud |
| `AGENT_PROMPT_CACHE_ROLLING` | `1` | yes | no | harness | Add a second, rolling cache_control breakpoint on the last stable conversation message so the prompt cache extends acros |
| `AGENT_PROTOCOL_INTENT_HINT` | `any` | yes | no | advanced | Harness environment toggle for Protocol Intent Hint. See docs/configuration.md (advanced). |
| `AGENT_PROVIDER_ALLOW_FALLBACKS` | `0` | yes | no | harness | Harness environment toggle for Provider Allow Fallbacks. See docs/configuration.md (harness). |
| `AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS` | `60000` | yes | yes | harness | Harness environment toggle for Provider Circuit Cooldown Ms. See docs/configuration.md (harness). |
| `AGENT_PROVIDER_CIRCUIT_FAILURES` | `3` | yes | yes | advanced | Harness environment toggle for Provider Circuit Failures. See docs/configuration.md (advanced). |
| `AGENT_PROVIDER_MIN_INTERVAL_MS` | `0` | yes | no | models_api | Harness environment toggle for Provider Min Interval Ms. See docs/configuration.md (models api). |
| `AGENT_PROVIDER_ORDER` | `DeepInfra` | yes | no | harness | Harness environment toggle for Provider Order. See docs/configuration.md (harness). |
| `AGENT_PROVIDER_ORDER_FAST` | `DeepInfra` | yes | no | harness | Harness environment toggle for Provider Order Fast. See docs/configuration.md (harness). |
| `AGENT_PROVIDER_ROUTE_AUTO` | `1` | yes | no | harness | Harness environment toggle for Provider Route Auto. See docs/configuration.md (harness). |
| `AGENT_PSEUDO_TOOL_RETRY_MAX` | `2` | yes | no | harness | Harness environment toggle for Pseudo Tool Retry Max. See docs/configuration.md (harness). |
| `AGENT_QUERY_REWRITE` | `0` | yes | no | memory_vault | Harness environment toggle for Query Rewrite. See docs/configuration.md (memory vault). |
| `AGENT_QUERY_REWRITE_EXPLORATORY` | `0` | yes | no | memory_vault | Harness environment toggle for Query Rewrite Exploratory. See docs/configuration.md (memory vault). |
| `AGENT_RATE_LIMIT_MAX_RETRIES` | `8` | yes | yes | models_api | Harness environment toggle for Rate Limit Max Retries. See docs/configuration.md (models api). |
| `AGENT_REASONING_BUDGET` | `1` | yes | no | harness | Harness environment toggle for Reasoning Budget. See docs/configuration.md (harness). |
| `AGENT_REASONING_DEFAULT_EFFORT` | `high` | yes | no | harness | Harness environment toggle for Reasoning Default Effort. See docs/configuration.md (harness). |
| `AGENT_REASONING_EXTERNAL_SLUGS` | `` | yes | no | harness | Harness environment toggle for Reasoning External Slugs. See docs/configuration.md (harness). |
| `AGENT_REASONING_NATIVE_SLUGS` | `` | yes | no | harness | Harness environment toggle for Reasoning Native Slugs. See docs/configuration.md (harness). |
| `AGENT_REASONING_NUDGE_CHARS` | `2500` | yes | no | harness | Harness environment toggle for Reasoning Nudge Chars. See docs/configuration.md (harness). |
| `AGENT_REASONING_SURFACE` | `external` | yes | no | harness | Harness environment toggle for Reasoning Surface. See docs/configuration.md (harness). |
| `AGENT_RECALL_EVERY_N` | `0` | yes | no | memory_vault | Harness environment toggle for Recall Every N. See docs/configuration.md (memory vault). |
| `AGENT_RECALL_RERANK` | `0` | yes | no | memory_vault | Second-stage fast-model rerank over fused recall candidates (sidecar call; off by default). See docs/configuration.md (m |
| `AGENT_RECALL_RERANK_WEIGHT` | `1.0` | yes | no | memory_vault | Blend weight for the recall reranker: finalScore = hybrid * (1 + weight * relevance). See docs/configuration.md (memory  |
| `AGENT_RECIPE_LIBRARY` | `1` | yes | no | advanced | Harness environment toggle for Recipe Library. See docs/configuration.md (advanced). |
| `AGENT_REFLEXION_SEMANTIC` | `1` | yes | no | harness | Harness environment toggle for Reflexion Semantic. See docs/configuration.md (harness). |
| `AGENT_RETRY_FOREVER` | `0` | yes | no | models_api | Harness environment toggle for Retry Forever. See docs/configuration.md (models api). |
| `AGENT_RETRY_MAX_DELAY_MS` | `30000` | yes | yes | models_api | Harness environment toggle for Retry Max Delay Ms. See docs/configuration.md (models api). |
| `AGENT_RETRY_WALL_TIME_MS` | `90000` | yes | yes | models_api | Harness environment toggle for Retry Wall Time Ms. See docs/configuration.md (models api). |
| `AGENT_RULE_DEMOTE_MIN_SAMPLES` | `20` | yes | no | advanced | Minimum outcomeCount required before a rule can be auto-demoted. Default 20. |
| `AGENT_RULE_DEMOTE_THRESHOLD` | `0.4` | yes | no | advanced | Avg turn-outcome below which a harness rule is auto-demoted from the round-2 recall (0–1). Default 0.4. |
| `AGENT_RULE_RECALL` | `1` | yes | no | memory_vault | Harness environment toggle for Rule Recall. See docs/configuration.md (memory vault). |
| `AGENT_SAFETY_JUDGE` | `0` | yes | no | safety | Harness environment toggle for Safety Judge. See docs/configuration.md (safety). |
| `AGENT_SAFETY_JUDGE_MODEL` | `deepseek/deepseek-v4-flash` | yes | no | safety | Harness environment toggle for Safety Judge Model. See docs/configuration.md (safety). |
| `AGENT_SELF_HEAL_LINT` | `0` | yes | no | harness | Harness environment toggle for Self Heal Lint. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_LINT_MODE` | `tsc` | yes | no | harness | Harness environment toggle for Self Heal Lint Mode. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_MAX_PASSES` | `4` | yes | no | harness | Harness environment toggle for Self Heal Max Passes. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_REPO_WIDE` | `0` | yes | no | harness | Harness environment toggle for Self Heal Repo Wide. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS` | `1` | yes | no | harness | Harness environment toggle for Self Heal Stop On No Progress. See docs/configuration.md (harness). |
| `AGENT_SEND_TIMEOUT_MS` | `1800000` | yes | no | models_api | Harness environment toggle for Send Timeout Ms. See docs/configuration.md (models api). |
| `AGENT_SESSION_GREET` | `0` | yes | no | session_ui | Harness environment toggle for Session Greet. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL` | `1` | yes | no | session_ui | Harness environment toggle for Session Jsonl. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_MAX_ROLLUP_CHARS` | `500000` | yes | no | session_ui | Harness environment toggle for Session Jsonl Max Rollup Chars. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_TEXT_LOG` | `rollup` | yes | no | session_ui | Harness environment toggle for Session Jsonl Text Log. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_TRACE` | `0` | yes | no | session_ui | Harness environment toggle for Session Jsonl Trace. See docs/configuration.md (session ui). |
| `AGENT_SESSION_MODE` | `` | yes | no | session_ui | Harness environment toggle for Session Mode. See docs/configuration.md (session ui). |
| `AGENT_SPECULATIVE_READS` | `0` | yes | no | memory_vault | Harness environment toggle for Speculative Reads. See docs/configuration.md (memory vault). |
| `AGENT_STREAM_CHUNK_TIMEOUT_MS` | `60000` | yes | no | harness | Harness environment toggle for Stream Chunk Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_STREAM_MAX_RETRIES` | `3` | yes | no | harness | Harness environment toggle for Stream Max Retries. See docs/configuration.md (harness). |
| `AGENT_TOOL_BODY_ELIDE` | `0` | yes | no | memory_vault | Harness environment toggle for Tool Body Elide. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_ELIDE_KEEP_ROUNDS` | `3` | yes | no | memory_vault | Harness environment toggle for Tool Elide Keep Rounds. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_ELIDE_MIN_CHARS` | `12000` | yes | no | memory_vault | Harness environment toggle for Tool Elide Min Chars. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_LAZY` | `1` | yes | no | harness | Harness environment toggle for Tool Lazy. See docs/configuration.md (harness). |
| `AGENT_TRANSCRIBE_AUTO_ON_UPLOAD` | `1` | yes | no | models_api | When 1, dropping an audio/video file in the chat auto-transcribes and appends to the input draft. |
| `AGENT_TRANSCRIBE_BASE_URL` | `https://openrouter.ai/api/v1` | yes | no | models_api | OpenAI-compatible base URL for /audio/transcriptions. Defaults to OpenRouter. |
| `AGENT_TRANSCRIBE_ENABLED` | `1` | yes | no | models_api | Master switch for audio transcription (the transcribe_audio tool, mic button, audio drag-drop). |
| `AGENT_TRANSCRIBE_MAX_BYTES` | `26214400` | yes | no | models_api | Per-call upload cap. Default 25 MB. |
| `AGENT_TRANSCRIBE_MODEL` | `openai/whisper-large-v3-turbo` | yes | no | models_api | ASR model slug. Defaults to openai/whisper-large-v3-turbo ($0.04/hour). Cheapest options: qwen/qwen3-asr-flash, openai/w |
| `AGENT_TRANSCRIBE_TIMEOUT_MS` | `120000` | yes | no | models_api | Per-call wall-clock timeout for the transcription request. |
| `AGENT_TRANSCRIBE_TIMESTAMPS` | `segment` | yes | no | models_api | Timestamp granularity in the response: none, segment (default), or word. |
| `AGENT_TRANSIENT_5XX_MAX_RETRIES` | `8` | yes | yes | models_api | Harness environment toggle for Transient 5xx Max Retries. See docs/configuration.md (models api). |
| `AGENT_TTS_BASE_URL` | `https://openrouter.ai/api/v1` | yes | no | models_api | OpenAI-compatible base URL for /audio/speech. Defaults to OpenRouter. |
| `AGENT_TTS_CHUNK_CHARS` | `400` | yes | no | models_api | Max characters per upstream /audio/speech request (default 400). Longer speak() text is split into sequential clips. Ope |
| `AGENT_TTS_ENABLED` | `0` | yes | no | models_api | Master switch for Jarvis-style spoken updates (speak tool + web audio queue). Written chat stays the full deliverable. |
| `AGENT_TTS_MAX_CALLS_PER_TURN` | `8` | yes | no | models_api | Hard cap on speak() calls per user message (default 8). |
| `AGENT_TTS_MAX_CHARS_PER_CALL` | `4096` | yes | no | models_api | Max characters per speak() after sanitization (default 4096 — matches OpenRouter TTS input context; values above 4096 ar |
| `AGENT_TTS_MAX_OUTPUT_TOKENS` | `4096` | yes | no | models_api | Optional passthrough max_tokens per segment (some providers). Long lines are split via AGENT_TTS_CHUNK_CHARS instead. |
| `AGENT_TTS_MIN_INTERVAL_MS` | `800` | yes | no | models_api | Minimum spacing between spoken clips to avoid machine-gun audio (default 800ms). |
| `AGENT_TTS_MODEL` | `hexgrad/kokoro-82m` | yes | no | models_api | TTS model slug for /audio/speech. Default hexgrad/kokoro-82m (~$0.62/M characters on OpenRouter). |
| `AGENT_TTS_RESPONSE_FORMAT` | `mp3` | yes | no | models_api | Audio format for /audio/speech. OpenRouter accepts mp3 or pcm only (wav/opus/flac are coerced to mp3). Use Kokoro voices |
| `AGENT_TTS_TIMEOUT_MS` | `45000` | yes | no | models_api | Per-call wall-clock timeout for speech synthesis. |
| `AGENT_TTS_VOICE` | `af_sky` | yes | no | models_api | Voice preset — must match TTS model: Kokoro (af_sky, af_bella, am_adam, …) or OpenAI (alloy, nova, shimmer, …). Mismatch |
| `AGENT_UI_VERBOSITY` | `normal` | yes | yes | session_ui | Harness environment toggle for Ui Verbosity. See docs/configuration.md (session ui). |
| `AGENT_UPSTREAM_429_SUGGESTED_WAIT_MS` | `` | yes | no | models_api | Harness environment toggle for Upstream 429 Suggested Wait Ms. See docs/configuration.md (models api). |
| `AGENT_VAULT_AUTO_WRITE` | `off` | yes | yes | memory_vault | Harness environment toggle for Vault Auto Write. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_DEDUPE` | `0` | yes | no | memory_vault | Harness environment toggle for Vault Dedupe. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_PATH` | `` | yes | no | memory_vault | Harness environment toggle for Vault Path. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_REQUIRE_LINKS` | `0` | yes | no | memory_vault | Harness environment toggle for Vault Require Links. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_WRITE_BUDGET` | `8` | yes | no | memory_vault | Harness environment toggle for Vault Write Budget. See docs/configuration.md (memory vault). |
| `AGENT_VISION_BASE_URL` | `https://openrouter.ai/api/v1` | yes | yes | models_api | Harness environment toggle for Vision Base Url. See docs/configuration.md (models api). |
| `AGENT_VISION_MAX_IMAGE_BYTES` | `4194304` | yes | yes | models_api | Harness environment toggle for Vision Max Image Bytes. See docs/configuration.md (models api). |
| `AGENT_VISION_MODEL` | `nvidia/nemotron-nano-12b-v2-vl:free` | yes | yes | models_api | Harness environment toggle for Vision Model. See docs/configuration.md (models api). |
| `AGENT_VISION_RETRIES` | `2` | yes | no | models_api | Harness environment toggle for Vision Retries. See docs/configuration.md (models api). |
| `AGENT_VISION_RETRY_BASE_MS` | `800` | yes | no | models_api | Harness environment toggle for Vision Retry Base Ms. See docs/configuration.md (models api). |
| `AGENT_VISION_TIMEOUT_MS` | `45000` | yes | yes | models_api | Harness environment toggle for Vision Timeout Ms. See docs/configuration.md (models api). |
| `AGENT_WEB_FETCH_403_RETRY` | `1` | yes | no | web_research | Harness environment toggle for Web Fetch 403 Retry. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_ACCEPT_LANGUAGE` | `` | yes | no | web_research | Harness environment toggle for Web Fetch Accept Language. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_ALT_USER_AGENT` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0` | yes | no | web_research | Harness environment toggle for Web Fetch Alt User Agent. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_ASSETS_MAX_CHARS` | `4000` | yes | no | web_research | Separate char budget for discovered links/images appendix when include_assets=true. |
| `AGENT_WEB_FETCH_DEFAULT_MAX_CHARS` | `32000` | yes | no | web_research | Default max_chars for web_fetch when the model omits it (body budget). |
| `AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE` | `` | yes | no | web_research | Harness environment toggle for Web Fetch Fallback Url Template. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS` | `400000` | yes | no | web_research | Harness environment toggle for Web Fetch Max Preprocess Chars. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS` | `72000` | yes | no | web_research | Harness environment toggle for Web Fetch Readability Max Input Chars. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_READABILITY_MS` | `12000` | yes | no | web_research | Harness environment toggle for Web Fetch Readability Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_REFERER` | `` | yes | no | web_research | Harness environment toggle for Web Fetch Referer. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_RETRIES` | `2` | yes | no | web_research | Harness environment toggle for Web Fetch Retries. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS` | `6000` | yes | no | web_research | Harness environment toggle for Web Fetch Retry Max Delay Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_SEC_CH_PLATFORM` | `` | yes | no | web_research | Harness environment toggle for Web Fetch Sec Ch Platform. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_TIMEOUT_MS` | `20000` | yes | no | web_research | Harness environment toggle for Web Fetch Timeout Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_TOTAL_WALL_MS` | `55000` | yes | no | web_research | Harness environment toggle for Web Fetch Total Wall Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_USER_AGENT` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36` | yes | no | web_research | Harness environment toggle for Web Fetch User Agent. See docs/configuration.md (web research). |
| `AGENT_WEB_READABILITY` | `1` | yes | no | web_research | Harness environment toggle for Web Readability. See docs/configuration.md (web research). |
| `AGENT_WEB_RESEARCH` | `1` | yes | no | web_research | Harness environment toggle for Web Research. See docs/configuration.md (web research). |
| `AGENT_WRITE_INTEGRITY_NUDGE` | `1` | yes | no | harness | Harness environment toggle for Write Integrity Nudge. See docs/configuration.md (harness). |
| `AGENT_WRITE_PART_MAX_CHARS` | `512000` | yes | no | harness | Harness environment toggle for Write Part Max Chars. See docs/configuration.md (harness). |
| `AGENT_WRITE_STREAM_SINK` | `1` | yes | no | harness | Harness environment toggle for Write Stream Sink. See docs/configuration.md (harness). |
| `AGENT_WRITE_STREAM_SINK_MIN_CHARS` | `8000` | yes | no | harness | Harness environment toggle for Write Stream Sink Min Chars. See docs/configuration.md (harness). |
| `AGENT_YIELD_EVERY_N` | `0` | yes | no | session_ui | Harness environment toggle for Yield Every N. See docs/configuration.md (session ui). |
| `AGENT_YOLO` | `0` | yes | no | safety | Harness environment toggle for Yolo. See docs/configuration.md (safety). |

## Secret keys (.env only)

- `AGENT_API_KEY`
- `AGENT_APPROVAL_TIMEOUT_MS`
- `AGENT_CAPTCHA_KEY`
- `AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS`
- `AGENT_PROVIDER_CIRCUIT_FAILURES`
- `AGENT_RATE_LIMIT_MAX_RETRIES`
- `AGENT_RETRY_MAX_DELAY_MS`
- `AGENT_RETRY_WALL_TIME_MS`
- `AGENT_TRANSCRIBE_API_KEY`
- `AGENT_TRANSIENT_5XX_MAX_RETRIES`
- `AGENT_UI_VERBOSITY`
- `AGENT_VAULT_AUTO_WRITE`
- `AGENT_VISION_API_KEY`
- `AGENT_VISION_BASE_URL`
- `AGENT_VISION_MAX_IMAGE_BYTES`
- `AGENT_VISION_MODEL`
- `AGENT_VISION_TIMEOUT_MS`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `XAI_API_KEY`

## Related

- [Configuration reference](../configuration.md) — narrative groups
- Repo root `CLAUDE.md` — contributor quick reference (not linked; lives outside `docs/`)
