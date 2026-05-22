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
| `AGENT_API_BASE_URL` | `http://localhost:1234/v1` | yes | no | models_api | Harness environment toggle for Api Base Url. See docs/configuration.md (models api). |
| `AGENT_APPROVAL_TIMEOUT_MS` | `120000` | yes | yes | safety | Harness environment toggle for Approval Timeout Ms. See docs/configuration.md (safety). |
| `AGENT_AUTO_DREAM` | `0` | yes | no | session_ui | Harness environment toggle for Auto Dream. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_ALLOW_DELETE` | `0` | yes | no | session_ui | Harness environment toggle for Auto Dream Allow Delete. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_INJECT_TRANSCRIPT` | `1` | yes | no | session_ui | When `1` (default), append a short system-scoped consolidation summary after each successful auto-dream run. Set to `0`  |
| `AGENT_AUTO_DREAM_LOCK_STALE_MS` | `3600000` | yes | no | session_ui | Harness environment toggle for Auto Dream Lock Stale Ms. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_CHARS_PER_SESSION` | `10000` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Chars Per Session. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_SESSION_FILES` | `8` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Session Files. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MAX_TOTAL_CHARS` | `40000` | yes | no | session_ui | Harness environment toggle for Auto Dream Max Total Chars. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MIN_HOURS` | `24` | yes | no | session_ui | Harness environment toggle for Auto Dream Min Hours. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_MIN_SESSIONS` | `5` | yes | no | session_ui | Harness environment toggle for Auto Dream Min Sessions. See docs/configuration.md (session ui). |
| `AGENT_AUTO_DREAM_SCAN_INTERVAL_MS` | `600000` | yes | no | session_ui | Harness environment toggle for Auto Dream Scan Interval Ms. See docs/configuration.md (session ui). |
| `AGENT_BROWSER` | `1` | yes | no | web_research | Harness environment toggle for Browser. See docs/configuration.md (web research). |
| `AGENT_COMPRESS_SEMANTIC` | `0` | yes | no | session_ui | Harness environment toggle for Compress Semantic. See docs/configuration.md (session ui). |
| `AGENT_CONCURRENCY_COOLDOWN_MS` | `60000` | yes | no | harness | Harness environment toggle for Concurrency Cooldown Ms. See docs/configuration.md (harness). |
| `AGENT_CRITIC` | `0` | yes | no | harness | Harness environment toggle for Critic. See docs/configuration.md (harness). |
| `AGENT_CRITIC_EVIDENCE` | `1` | yes | no | harness | Harness environment toggle for Critic Evidence. See docs/configuration.md (harness). |
| `AGENT_CRITIC_MIN_TOOLS` | `4` | yes | no | harness | Harness environment toggle for Critic Min Tools. See docs/configuration.md (harness). |
| `AGENT_CRITIC_MODE` | `single` | yes | no | harness | Harness environment toggle for Critic Mode. See docs/configuration.md (harness). |
| `AGENT_CRITIC_REQUIRE` | `0` | yes | no | harness | Harness environment toggle for Critic Require. See docs/configuration.md (harness). |
| `AGENT_DISTILL` | `1` | yes | no | memory_vault | Harness environment toggle for Distill. See docs/configuration.md (memory vault). |
| `AGENT_DOC_AUTONOMY` | `1` | yes | no | documents | Harness environment toggle for Doc Autonomy. See docs/configuration.md (documents). |
| `AGENT_DOC_ENGINE` | `1` | yes | no | documents | Harness environment toggle for Doc Engine. See docs/configuration.md (documents). |
| `AGENT_DOC_MAX_SOURCE_LOOKUPS` | `24` | yes | no | documents | Harness environment toggle for Doc Max Source Lookups. See docs/configuration.md (documents). |
| `AGENT_DOC_QUALITY_MIN` | `90` | yes | no | documents | Harness environment toggle for Doc Quality Min. See docs/configuration.md (documents). |
| `AGENT_DOC_REPAIR_BUDGET` | `4` | yes | no | documents | Harness environment toggle for Doc Repair Budget. See docs/configuration.md (documents). |
| `AGENT_DOC_STYLE_DIVERSITY_MIN` | `0.12` | yes | no | documents | Harness environment toggle for Doc Style Diversity Min. See docs/configuration.md (documents). |
| `AGENT_DOC_WEB_ASSETS` | `1` | yes | no | web_research | Harness environment toggle for Doc Web Assets. See docs/configuration.md (web research). |
| `AGENT_EMBED_MODEL` | `nvidia/llama-nemotron-embed-vl-1b-v2:free` | yes | no | models_api | Harness environment toggle for Embed Model. See docs/configuration.md (models api). |
| `AGENT_EVAL_JSON_SINK` | `1` | yes | no | advanced | Harness environment toggle for Eval Json Sink. See docs/configuration.md (advanced). |
| `AGENT_FAILURE_DIGEST` | `1` | yes | no | advanced | Harness environment toggle for Failure Digest. See docs/configuration.md (advanced). |
| `AGENT_FAILURE_LOG` | `1` | yes | no | advanced | Harness environment toggle for Failure Log. See docs/configuration.md (advanced). |
| `AGENT_FAST_MODEL` | `qwen/qwen3.5-9b` | yes | no | models_api | Harness environment toggle for Fast Model. See docs/configuration.md (models api). |
| `AGENT_FINALIZE_CITE` | `1` | yes | no | harness | Harness environment toggle for Finalize Cite. See docs/configuration.md (harness). |
| `AGENT_FINALIZE_HINT` | `0` | yes | no | harness | Harness environment toggle for Finalize Hint. See docs/configuration.md (harness). |
| `AGENT_FINALIZE_RETRY_BUDGET` | `1` | yes | no | harness | Harness environment toggle for Finalize Retry Budget. See docs/configuration.md (harness). |
| `AGENT_GOLDEN_EVAL` | `1` | yes | no | advanced | Harness environment toggle for Golden Eval. See docs/configuration.md (advanced). |
| `AGENT_HEARTBEAT` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_IDLE_MS` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Idle Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MAX_TOKENS` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Max Tokens. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Max User Nudges Per Hour. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_MIN_INTERVAL_MS` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Min Interval Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_SURFACE` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Surface. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_TIMEOUT_MS` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Timeout Ms. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_UI_STRIP` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat Ui Strip. See docs/configuration.md (session ui). |
| `AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN` | `—` | yes | no | session_ui | Harness environment toggle for Heartbeat User Nudge Confidence Min. See docs/configuration.md (session ui). |
| `AGENT_INTENT_CONFIDENCE_MIN` | `0.65` | yes | no | harness | Harness environment toggle for Intent Confidence Min. See docs/configuration.md (harness). |
| `AGENT_INTENT_CONTEXT_MAX_CHARS` | `12000` | yes | no | harness | Harness environment toggle for Intent Context Max Chars. See docs/configuration.md (harness). |
| `AGENT_INTENT_INFERENCE` | `1` | yes | no | harness | Harness environment toggle for Intent Inference. See docs/configuration.md (harness). |
| `AGENT_INTENT_REPO_CONTEXT` | `0` | yes | no | harness | Harness environment toggle for Intent Repo Context. See docs/configuration.md (harness). |
| `AGENT_LENGTH_RESUME_MAX` | `3` | yes | no | harness | Max auto-continue rounds when output hits length limit or file-write tool JSON is truncated (0–8, default 3). |
| `AGENT_LINT_ALLOWED_COMMANDS` | `` | yes | no | advanced | Harness environment toggle for Lint Allowed Commands. See docs/configuration.md (advanced). |
| `AGENT_LOCATION` | `—` | yes | no | session_ui | Harness environment toggle for Location. See docs/configuration.md (session ui). |
| `AGENT_MARKETS_ENABLE` | `1` | yes | no | web_research | Harness environment toggle for Markets Enable. See docs/configuration.md (web research). |
| `AGENT_MARKETS_MAX_DELAY_MS` | `2000` | yes | no | web_research | Harness environment toggle for Markets Max Delay Ms. See docs/configuration.md (web research). |
| `AGENT_MARKETS_RETRIES` | `2` | yes | no | web_research | Harness environment toggle for Markets Retries. See docs/configuration.md (web research). |
| `AGENT_MARKETS_TIMEOUT_MS` | `8000` | yes | no | web_research | Harness environment toggle for Markets Timeout Ms. See docs/configuration.md (web research). |
| `AGENT_MAX_COMPLETION_TOKENS` | `0` | yes | no | harness | Main model max_tokens per completion (0 = provider default). Caps very long single completions. |
| `AGENT_MEMORY_AUTOLINK` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Autolink. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_AUTOLINK_MODEL` | `qwen/qwen3.5-9b` | yes | no | models_api | Harness environment toggle for Memory Autolink Model. See docs/configuration.md (models api). |
| `AGENT_MEMORY_AUTO_EXTRACT` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Auto Extract. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_CONSOLIDATE_MODEL` | `qwen/qwen3.5-9b` | yes | no | models_api | Harness environment toggle for Memory Consolidate Model. See docs/configuration.md (models api). |
| `AGENT_MEMORY_DEBIAS` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Debias. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_EPISODE` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Episode. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Exploratory Auto Recall. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_GRAPH` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Graph. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_INTROSPECTION_STRICT` | `0` | yes | no | memory_vault | Harness environment toggle for Memory Introspection Strict. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_MAX_AGE_DAYS_DEFAULT` | `540` | yes | no | memory_vault | Harness environment toggle for Memory Max Age Days Default. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT` | `0.35` | yes | no | memory_vault | Harness environment toggle for Memory Min Confidence Default. See docs/configuration.md (memory vault). |
| `AGENT_MEMORY_PRIME_ROUND0` | `1` | yes | no | memory_vault | Harness environment toggle for Memory Prime Round0. See docs/configuration.md (memory vault). |
| `AGENT_MIN_CONCURRENT_AGENTS` | `1` | yes | no | harness | Harness environment toggle for Min Concurrent Agents. See docs/configuration.md (harness). |
| `AGENT_MODEL` | `qwen/qwen3.5-9b` | yes | no | models_api | Harness environment toggle for Model. See docs/configuration.md (models api). |
| `AGENT_OBSIDIAN_DISCOVER` | `1` | yes | no | memory_vault | Harness environment toggle for Obsidian Discover. See docs/configuration.md (memory vault). |
| `AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN` | `1` | yes | no | memory_vault | Harness environment toggle for Obsidian Require Dot Obsidian. See docs/configuration.md (memory vault). |
| `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING` | `—` | yes | no | memory_vault | Harness environment toggle for Obsidian Vault Name Substring. See docs/configuration.md (memory vault). |
| `AGENT_OVERINFERENCE_GUARD` | `1` | yes | no | harness | Harness environment toggle for Overinference Guard. See docs/configuration.md (harness). |
| `AGENT_OVERINFERENCE_LLM_CHECK` | `1` | yes | no | harness | Harness environment toggle for Overinference Llm Check. See docs/configuration.md (harness). |
| `AGENT_PASTE` | `0` | yes | no | session_ui | Harness environment toggle for Paste. See docs/configuration.md (session ui). |
| `AGENT_PERSONA_BOOTSTRAP` | `1` | yes | no | session_ui | Harness environment toggle for Persona Bootstrap. See docs/configuration.md (session ui). |
| `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` | `1` | yes | no | session_ui | Harness environment toggle for Persona Bootstrap Allow Skip. See docs/configuration.md (session ui). |
| `AGENT_PERSONA_GEN_RETRIES` | `2` | yes | no | harness | Harness environment toggle for Persona Gen Retries. See docs/configuration.md (harness). |
| `AGENT_PERSONA_GEN_TIMEOUT_MS` | `90000` | yes | no | harness | Harness environment toggle for Persona Gen Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_PERSONA_INFER_MODEL` | `` | yes | no | models_api | Harness environment toggle for Persona Infer Model. See docs/configuration.md (models api). |
| `AGENT_PLUGIN_DIR` | `` | yes | no | advanced | Harness environment toggle for Plugin Dir. See docs/configuration.md (advanced). |
| `AGENT_PROCESS_HEALTH` | `0` | yes | no | advanced | Harness environment toggle for Process Health. See docs/configuration.md (advanced). |
| `AGENT_PROTOCOL_INTENT_HINT` | `any` | yes | no | advanced | Harness environment toggle for Protocol Intent Hint. See docs/configuration.md (advanced). |
| `AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS` | `60000` | yes | yes | harness | Harness environment toggle for Provider Circuit Cooldown Ms. See docs/configuration.md (harness). |
| `AGENT_PROVIDER_CIRCUIT_FAILURES` | `3` | yes | yes | advanced | Harness environment toggle for Provider Circuit Failures. See docs/configuration.md (advanced). |
| `AGENT_PROVIDER_MIN_INTERVAL_MS` | `0` | yes | no | models_api | Harness environment toggle for Provider Min Interval Ms. See docs/configuration.md (models api). |
| `AGENT_PSEUDO_TOOL_RETRY_MAX` | `2` | yes | no | harness | Harness environment toggle for Pseudo Tool Retry Max. See docs/configuration.md (harness). |
| `AGENT_QUERY_REWRITE` | `1` | yes | no | memory_vault | Harness environment toggle for Query Rewrite. See docs/configuration.md (memory vault). |
| `AGENT_QUERY_REWRITE_EXPLORATORY` | `0` | yes | no | memory_vault | Harness environment toggle for Query Rewrite Exploratory. See docs/configuration.md (memory vault). |
| `AGENT_RATE_LIMIT_MAX_RETRIES` | `8` | yes | yes | models_api | Harness environment toggle for Rate Limit Max Retries. See docs/configuration.md (models api). |
| `AGENT_RECALL_EVERY_N` | `3` | yes | no | memory_vault | Harness environment toggle for Recall Every N. See docs/configuration.md (memory vault). |
| `AGENT_RECIPE_LIBRARY` | `1` | yes | no | advanced | Harness environment toggle for Recipe Library. See docs/configuration.md (advanced). |
| `AGENT_REFLEXION_SEMANTIC` | `1` | yes | no | harness | Harness environment toggle for Reflexion Semantic. See docs/configuration.md (harness). |
| `AGENT_RETRY_FOREVER` | `0` | yes | no | models_api | Harness environment toggle for Retry Forever. See docs/configuration.md (models api). |
| `AGENT_RETRY_MAX_DELAY_MS` | `30000` | yes | yes | models_api | Harness environment toggle for Retry Max Delay Ms. See docs/configuration.md (models api). |
| `AGENT_RETRY_WALL_TIME_MS` | `90000` | yes | yes | models_api | Harness environment toggle for Retry Wall Time Ms. See docs/configuration.md (models api). |
| `AGENT_RULE_RECALL` | `1` | yes | no | memory_vault | Harness environment toggle for Rule Recall. See docs/configuration.md (memory vault). |
| `AGENT_SAFETY_JUDGE` | `1` | yes | no | safety | Harness environment toggle for Safety Judge. See docs/configuration.md (safety). |
| `AGENT_SAFETY_JUDGE_MODEL` | `—` | yes | no | safety | Harness environment toggle for Safety Judge Model. See docs/configuration.md (safety). |
| `AGENT_SELF_HEAL_LINT` | `1` | yes | no | harness | Harness environment toggle for Self Heal Lint. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_LINT_MODE` | `tsc` | yes | no | harness | Harness environment toggle for Self Heal Lint Mode. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_MAX_PASSES` | `4` | yes | no | harness | Harness environment toggle for Self Heal Max Passes. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_REPO_WIDE` | `0` | yes | no | harness | Harness environment toggle for Self Heal Repo Wide. See docs/configuration.md (harness). |
| `AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS` | `1` | yes | no | harness | Harness environment toggle for Self Heal Stop On No Progress. See docs/configuration.md (harness). |
| `AGENT_SEND_TIMEOUT_MS` | `1800000` | yes | no | models_api | Harness environment toggle for Send Timeout Ms. See docs/configuration.md (models api). |
| `AGENT_SESSION_GREET` | `1` | yes | no | session_ui | Harness environment toggle for Session Greet. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL` | `1` | yes | no | session_ui | Harness environment toggle for Session Jsonl. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_MAX_ROLLUP_CHARS` | `500000` | yes | no | session_ui | Harness environment toggle for Session Jsonl Max Rollup Chars. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_TEXT_LOG` | `rollup` | yes | no | session_ui | Harness environment toggle for Session Jsonl Text Log. See docs/configuration.md (session ui). |
| `AGENT_SESSION_JSONL_TRACE` | `0` | yes | no | session_ui | Harness environment toggle for Session Jsonl Trace. See docs/configuration.md (session ui). |
| `AGENT_SESSION_MODE` | `—` | yes | no | session_ui | Harness environment toggle for Session Mode. See docs/configuration.md (session ui). |
| `AGENT_SPECULATIVE_READS` | `1` | yes | no | memory_vault | Harness environment toggle for Speculative Reads. See docs/configuration.md (memory vault). |
| `AGENT_STREAM_CHUNK_TIMEOUT_MS` | `60000` | yes | no | harness | Harness environment toggle for Stream Chunk Timeout Ms. See docs/configuration.md (harness). |
| `AGENT_STREAM_MAX_RETRIES` | `3` | yes | no | harness | Harness environment toggle for Stream Max Retries. See docs/configuration.md (harness). |
| `AGENT_TOOL_BODY_ELIDE` | `1` | yes | no | memory_vault | Harness environment toggle for Tool Body Elide. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_ELIDE_KEEP_ROUNDS` | `3` | yes | no | memory_vault | Harness environment toggle for Tool Elide Keep Rounds. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_ELIDE_MIN_CHARS` | `10000` | yes | no | memory_vault | Harness environment toggle for Tool Elide Min Chars. See docs/configuration.md (memory vault). |
| `AGENT_TOOL_LAZY` | `1` | yes | no | harness | Harness environment toggle for Tool Lazy. See docs/configuration.md (harness). |
| `AGENT_TRANSIENT_5XX_MAX_RETRIES` | `8` | yes | yes | models_api | Harness environment toggle for Transient 5xx Max Retries. See docs/configuration.md (models api). |
| `AGENT_UI_VERBOSITY` | `normal` | yes | yes | session_ui | Harness environment toggle for Ui Verbosity. See docs/configuration.md (session ui). |
| `AGENT_UPSTREAM_429_SUGGESTED_WAIT_MS` | `—` | yes | no | models_api | Harness environment toggle for Upstream 429 Suggested Wait Ms. See docs/configuration.md (models api). |
| `AGENT_VAULT_AUTO_WRITE` | `off` | yes | yes | memory_vault | Harness environment toggle for Vault Auto Write. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_DEDUPE` | `1` | yes | no | memory_vault | Harness environment toggle for Vault Dedupe. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_PATH` | `—` | yes | no | memory_vault | Harness environment toggle for Vault Path. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_REQUIRE_LINKS` | `0` | yes | no | memory_vault | Harness environment toggle for Vault Require Links. See docs/configuration.md (memory vault). |
| `AGENT_VAULT_WRITE_BUDGET` | `8` | yes | no | memory_vault | Harness environment toggle for Vault Write Budget. See docs/configuration.md (memory vault). |
| `AGENT_VISION_BASE_URL` | `https://openrouter.ai/api/v1` | yes | yes | models_api | Harness environment toggle for Vision Base Url. See docs/configuration.md (models api). |
| `AGENT_VISION_MAX_IMAGE_BYTES` | `4194304` | yes | yes | models_api | Harness environment toggle for Vision Max Image Bytes. See docs/configuration.md (models api). |
| `AGENT_VISION_MODEL` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | yes | yes | models_api | Harness environment toggle for Vision Model. See docs/configuration.md (models api). |
| `AGENT_VISION_RETRIES` | `2` | yes | yes | models_api | Harness environment toggle for Vision Retries. See docs/configuration.md (models api). |
| `AGENT_VISION_RETRY_BASE_MS` | `800` | yes | yes | models_api | Harness environment toggle for Vision Retry Base Ms. See docs/configuration.md (models api). |
| `AGENT_VISION_TIMEOUT_MS` | `15000` | yes | yes | models_api | Harness environment toggle for Vision Timeout Ms. See docs/configuration.md (models api). |
| `AGENT_WEB_FETCH_403_RETRY` | `1` | yes | no | web_research | Harness environment toggle for Web Fetch 403 Retry. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_ACCEPT_LANGUAGE` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Accept Language. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_ALT_USER_AGENT` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Alt User Agent. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Fallback Url Template. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS` | `400000` | yes | no | web_research | Harness environment toggle for Web Fetch Max Preprocess Chars. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Readability Max Input Chars. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_READABILITY_MS` | `12000` | yes | no | web_research | Harness environment toggle for Web Fetch Readability Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_REFERER` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Referer. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_RETRIES` | `2` | yes | no | web_research | Harness environment toggle for Web Fetch Retries. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS` | `6000` | yes | no | web_research | Harness environment toggle for Web Fetch Retry Max Delay Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_SEC_CH_PLATFORM` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch Sec Ch Platform. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_TIMEOUT_MS` | `20000` | yes | no | web_research | Harness environment toggle for Web Fetch Timeout Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_TOTAL_WALL_MS` | `55000` | yes | no | web_research | Harness environment toggle for Web Fetch Total Wall Ms. See docs/configuration.md (web research). |
| `AGENT_WEB_FETCH_USER_AGENT` | `—` | yes | no | web_research | Harness environment toggle for Web Fetch User Agent. See docs/configuration.md (web research). |
| `AGENT_WEB_READABILITY` | `1` | yes | no | web_research | Harness environment toggle for Web Readability. See docs/configuration.md (web research). |
| `AGENT_WEB_RESEARCH` | `1` | yes | no | web_research | Harness environment toggle for Web Research. See docs/configuration.md (web research). |
| `AGENT_WRITE_INTEGRITY_NUDGE` | `1` | yes | no | harness | Inject a system note when file-write tools report likely_truncated. |
| `AGENT_WRITE_PART_MAX_CHARS` | `512000` | yes | no | harness | Maximum characters per write_file_part chunk. |
| `AGENT_WRITE_STREAM_SINK` | `0` | yes | no | harness | Stream file-write tool content to disk during model streaming (preserves partial bytes on cutoff). |
| `AGENT_WRITE_STREAM_SINK_MIN_CHARS` | `8000` | yes | no | harness | Minimum estimated content size before opening the stream sink. |
| `AGENT_YIELD_EVERY_N` | `0` | yes | no | session_ui | Harness environment toggle for Yield Every N. See docs/configuration.md (session ui). |
| `AGENT_YOLO` | `0` | yes | no | safety | Harness environment toggle for Yolo. See docs/configuration.md (safety). |

## Secret keys (.env only)

- `AGENT_API_KEY`
- `AGENT_APPROVAL_TIMEOUT_MS`
- `AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS`
- `AGENT_PROVIDER_CIRCUIT_FAILURES`
- `AGENT_RATE_LIMIT_MAX_RETRIES`
- `AGENT_RETRY_MAX_DELAY_MS`
- `AGENT_RETRY_WALL_TIME_MS`
- `AGENT_TRANSIENT_5XX_MAX_RETRIES`
- `AGENT_UI_VERBOSITY`
- `AGENT_VAULT_AUTO_WRITE`
- `AGENT_VISION_API_KEY`
- `AGENT_VISION_BASE_URL`
- `AGENT_VISION_MAX_IMAGE_BYTES`
- `AGENT_VISION_MODEL`
- `AGENT_VISION_RETRIES`
- `AGENT_VISION_RETRY_BASE_MS`
- `AGENT_VISION_TIMEOUT_MS`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `XAI_API_KEY`

## Related

- [Configuration reference](../configuration.md) — narrative groups
- Repo root `CLAUDE.md` — contributor quick reference (not linked; lives outside `docs/`)
