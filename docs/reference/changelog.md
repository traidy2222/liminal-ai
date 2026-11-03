# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) on the `main` branch.

**Current stage:** **beta** (`v0.1.19`, 2026-11-03). Desktop downloads are published through the public preview release channel.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

| Surface | Where |
| -------- | ----- |
| **Source of truth** | [`changelog/releases.json`](../../changelog/releases.json) — run `npm run changelog:gen` |
| **Technical changelog (this page)** | Generated from JSON — full `Shipped` bullets |
| **Marketing changelog** | [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog) |
| **Short index** | [CHANGELOG.md](https://github.com/traidy2222/liminal-ai/blob/main/CHANGELOG.md) |

After editing JSON: `npm run changelog:gen`, commit, push, then in [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website): `npm run docs-portal:sync` and `npm run docs-portal:deploy`.

---

## v0.1.19 — 2026-11-03 {#v0-1-19}

**Current beta.** Long tasks keep their plan and their actual command results.

**Shipped**

- **Progress without phantom budgets** — Elapsed rounds no longer invent a replacement plan or discard compensation history. Real contract budgets count from contract activation, and a hard stop leaves an explicit incomplete-work handoff.
- **Reliable Windows commands** — Run PowerShell foreground commands as owned noninteractive PTY jobs, surface each live job in the terminal, and isolate each command from stale prompts and prior scrollback. Multiline scripts execute as complete commands. UI observer errors do not fail or replay running jobs.
- **Honest failure status** — Non-zero exits remain failures even when diagnostic output is long. Interactive terminal tools and background jobs remain available for explicitly persistent workflows.
- **Retained command output** — Large or filtered foreground output is saved as a retrievable artifact before the completed terminal tab closes. If saving fails, return the captured output directly without repeating the command.
- **Regression evidence** — A 45-round harness fixture, late-plan budget checks, visible pause handoff and real Windows PTY commands cover the reported failure and its fixes.
- **Docs** — [Harness architecture](../concepts/architecture.md)

---

## v0.1.16 — 2026-11-03 {#v0-1-16}

Legitimate artifact work starts with evidence.

**Shipped**

- **Tool-first artifact work** — Route selected binary/package analysis to execution and ISO-to-launcher requests to coding. Keep the normal tool surface available instead of classifying these tasks as background Q&A.
- **Good-faith task handling** — Inspect the selected artifact, respect stated local-use and ownership context, and distinguish decompilation, emulator launchers and native ports. Avoid unsupported legal claims and accusations; explain actual technical blockers with evidence.
- **Existing boundaries retained** — Tool approvals and concrete safety limits remain in place. Conceptual questions, quoted examples and explicit negative instructions do not trigger the artifact fast path.
- **Docs** — [REA and local MCP](../guides/rea.md)

---

## v0.1.15 — 2026-11-03 {#v0-1-15}

REA and local MCP tools, ready when you need them.

**Shipped**

- **Full REA catalog** — Discover all 170 tools from the installed REA 6.4 server. Search and load the relevant tools instead of sending every schema with ordinary conversations. Native and platform-specific operations retain their provider prerequisites.
- **Native local MCP** — Persist executable and argument settings, keep secrets in environment variables, and run helpers outside the installation folder. Conversations and child dispatchers use independent sessions; stopped turns cancel their active MCP requests.
- **Faithful tool contracts** — Preserve root schema definitions, nested references, full descriptions, structured results and binary media. Honor mutation annotations and normal approvals; never replay a failed write automatically.
- **Verification** — Linux and Windows CI cover paginated discovery, schema preservation, lazy search, independent sessions, denied writes, cancellation and disconnect handling. The real installed REA server passed static JavaScript and headless IDA native fixture analysis, with owned database cleanup and no target execution.
- **Docs** — [REA and local MCP](../guides/rea.md)

---

## v0.1.14 — 2026-11-03 {#v0-1-14}

Windows updates without Google helper directory locks.

**Shipped**

- **Windows updates** — Start the Google Workspace helper from a dedicated user-data directory. Its child processes no longer hold the app folder open after the desktop exits, blocking the update's directory swap.
- **File writing** — Remove content-based email guessing from write_file. Schematics, dashboards, documentation and email-template assets save normally; file-write approvals, overwrite protection and mail-tool validation remain in place.
- **Regression coverage** — A live helper fixture reproduces the Windows EPERM before the fix, then permits the app-folder rename while remaining alive. Linux and Windows CI cover this behavior and the HTML file-writing regression.

---

## v0.1.13 — 2026-11-03 {#v0-1-13}

Gmail tools that preserve the server contract.

**Shipped**

- **Correct MCP arguments** — Preserve declared fields such as Gmail displayName, native snake_case keys and fractional numeric values. Compatibility aliases are resolved against the current tool, without adding extra model-facing fields.
- **Accurate Gmail behavior** — Recognize replyToMessageId, accept valid plain-text MCP drafts, describe HTML-capable drafts correctly and recover from unknown message IDs with a fresh search instead of replaying backend stack traces. Trash, spam, reply and forward actions are classified as writes. Gmail reads stay fresh after mailbox changes.
- **Verified live** — Reproduced the old dispatcher failure, created one uniquely named empty label with the repaired dispatcher and removed it. Gmail search and thread reads passed; no messages were changed or sent. The connected Gmail parameter schemas shrank by 68%.
- **Docs** — [Gmail MCP review](../reviews/gmail-mcp.md)

---

## v0.1.12 — 2026-11-03 {#v0-1-12}

Reliable Google sign-in, token refresh and Workspace tools.

**Shipped**

- **OAuth recovery** — An expired optional Liminal license no longer blocks provider-token renewal. Expired or unusable saved Google accounts no longer suppress a requested browser sign-in.
- **Google Workspace tools** — Recover the public Google client ID from verified token metadata when needed and supply process-local signing material required by workspace-mcp. Google authentication remains enabled and the service binds only to loopback.
- **Clear diagnostics** — Distinguish unavailable or failed token refresh from unreadable encrypted credentials. Includes regressions for expired-token reconnect, license-independent refresh and the hosted form handoff.
- **Docs** — [Integrations](../guides/google-workspace.md)

---

## v0.1.11 — 2026-11-03 {#v0-1-11}

Optional, content-free usage sharing with a clear off switch.

**Shipped**

- **Your choice** — A one-time hub card offers Share basic usage or No thanks. Change the setting later under About & updates; declining does not restrict the app.
- **Basic milestones only** — Report app launches, workspace readiness and completed user-started conversation days with app version, platform and a random installation identifier. No prompts, answers, files, paths, account details or provider keys are sent.
- **Useful activity counts** — Ignore transcript replay, background turns, errors and cancellations. Deduplicate each milestone per UTC day; network failures never block startup or conversations.
- **Delete and stop** — Turn sharing off immediately or delete that installation’s shared history without an account. Failed deletion stays off and can be retried. Daily records and inactive installation records have a 90-day retention policy.
- **Docs** — [Optional usage sharing](../concepts/usage-sharing.md)

---

## v0.1.10 — 2026-11-03 {#v0-1-10}

Clean shutdown even after Windows closes desktop output pipes.

**Shipped**

- **Closed-pipe recovery** — Handle EPIPE on desktop-owned output streams before startup or shutdown logging. Other output errors retain their existing error path, and standalone servers are unaffected.
- **Verified process regression** — A real child process with ignored stdin and both output pipes closed now completes its cleanup after parent termination. The unchanged test fails without the fix and passes with it.
- **Docs** — [Install and update](../start/install.md)

---

## v0.1.9 — 2026-11-03 {#v0-1-9}

Clean desktop shutdowns keep future updates unblocked.

**Shipped**

- **No orphaned desktop sidecars** — The app identifies its owned sidecar's parent process. If the desktop closes or crashes, the sidecar shuts down even when stdin does not report closure.
- **Reliable update preparation** — Release the old runtime's file handles before a future launch update replaces the app folder. Shutdown handles overlapping signals once.
- **Real process coverage** — A detached child with ignored stdin is tested against actual parent termination, including in Windows CI. Standalone servers and unrelated process IDs opt out.
- **Docs** — [Install and update](../start/install.md)

---

## v0.1.8 — 2026-11-02 {#v0-1-8}

Safer tool recovery and a verified Windows update handoff.

**Shipped**

- **Windows update handoff** — Avoid detached PowerShell startup failures. The app waits for the updater to initialize and stays open if startup fails. The helper waits for the old process to exit before replacing files.
- **Faster Windows extraction** — Use the Windows archive utility for large app bundles, retaining a PowerShell fallback when it is unavailable.
- **Workspace preservation** — Keep extra files and folders created at the bundled workspace root when they are absent from the new release, alongside credentials, preferences and saved workflow artifacts.
- **Safe tool recovery** — Preserve eager tool execution across stream recovery and isolate streamed-write manifests and staging files between concurrent sessions.
- **Access and lifecycle hardening** — Complete the reviewed fixes for guest chat boundaries, public-web destinations, file operations, locks, provider scheduling and terminal/browser cleanup.
- **Docs** — [Install and update](../start/install.md)

---

## v0.1.7 — 2026-11-02 {#v0-1-7}

Faster first answers and accurate file-write status.

**Shipped**

- **Faster first answers** — Stop hidden native thinking on supported DeepSeek hybrid models when external reasoning is selected. Native reasoning budgets and mandatory-reasoning models retain their existing behavior.
- **Responsive provider routing** — Default new routing to latency, remove the implicit price-sort override, and refresh sticky provider affinity when routing policy or model changes. Existing explicit preferences remain respected.
- **Accurate write status** — Successful tool results immediately show saved, failed writes show failure, and interrupted turns stop active indicators without claiming success. Late stream or approval events cannot reopen completed writes.
- **Visible verification** — Keep completed file previews available, preserve another active preview during parallel writes, and record harness preparation and first-answer timings separately in session logs.
- **Docs** — [Response latency](../guides/response-latency.md), [Install and update](../start/install.md)

---

## v0.1.6 — 2026-11-02 {#v0-1-6}

Verified automatic updates before your workspace opens.

**Shipped**

- **Automatic launch updates** — Enabled by default for portable installs. Update checks load saved preferences and installed versions before the harness starts, correctly recognize bundled runtimes, and do not interrupt active work after reconnects.
- **Clear launch progress** — Download progress and an Open current version option let you continue without installing. Automatic updates can be disabled in About & updates.
- **Verified downloads** — Stream archives to disk, require valid SHA256 checksums, reject incomplete responses and partial releases, and reuse verified cached archives.
- **Reliable installation** — Run the detached helper outside the install folder, preserve local configuration, prepare the replacement before swapping, and restore the old app if replacement or relaunch fails. Correct the Windows helper PID conflict and macOS bundle destination.
- **Recovery without restart loops** — Record a durable automatic attempt before restart; an unsuccessful version requires a manual retry. Check failures and download errors leave the current app usable.
- **Docs** — [Install and update](../start/install.md)

---

## v0.1.5 — 2026-11-02 {#v0-1-5}

Three guided workflows with saved deliverables and recoverable progress.

**Shipped**

- **Enquiry to proposal** — Research primary sources and save a printable proposal, editable Markdown, source list, and unsent reply draft with `/proposal`.
- **Receipt to expense review** — Local English OCR, date/currency/arithmetic checks, source hashes, and an optional approved Xero DRAFT with an attached receipt. Xero writes are adapter-tested with fixtures; no live-account certification is claimed.
- **Bug report to verified patch** — `/fix` requires a reproduced failure, passing tests after edits, and a fresh Git diff before saving the patch, test output, and handoff.
- **Recoverable work** — List and resume saved runs with `/workflows` and `/resume-work`. Retry interrupted receipt uploads against the existing bill ID; resumed patches require fresh verification.
- **Desktop and web delivery** — New welcome cards, file buttons, safe web downloads, and receipt submission recovery. Completed workflow checks finish with a concise handoff.
- **Windows verification** — Terminal replay checks wait for actual shell output and clean up on failure. A version-pinned node-pty compatibility fix prevents console teardown races and releases the output worker after natural shell exit. Native PowerShell commands preserve their real exit codes. Required npm tests cannot silently pass when scripts are absent; Windows CI covers terminal and workflow checks.
- **Docs** — [Guided workflows](../guides/signature-workflows.md)

---

## v0.1.4 — 2026-11-02 {#v0-1-4}

Searchable OpenRouter models, single-model operation, and a faster response path.

**Shipped**

- **OpenRouter catalog** — Search the live catalog by name or model ID, inspect tool and vision capabilities, and select individual models without applying model bundles.
- **Single-model mode** — Keep chat, background completions, and vision on the selected model; disable separate embeddings, hosted speech, and automatic model fallbacks while preserving specialist preferences.
- **Faster first replies** — Use local intent routing by default, skip unused classifier repo scans, and warm installed-tool inventory at startup. The optional remote classifier remains available.
- **Latency visibility** — Separate harness preparation, provider output, and first answer text in telemetry; add a reproducible live benchmark and document its limits.
- **Updated presentation** — New desktop and web marketing images, a clearer README, corrected setup guidance, and explicit beta release information.
- **Docs** — [Response latency](../guides/response-latency.md)

---

## v0.1.3 — 2026-11-02 {#v0-1-3}

A redesigned workspace and simpler settings across desktop and web.

**Shipped**

- **Workspace redesign** — Shared typography, neutral surfaces, clearer navigation, conversation layouts, and composers across desktop and web.
- **Desktop hub** — Recent conversations, a searchable paginated library, mission editor, connected tools, and inbox navigation.
- **Simpler settings** — Clear categories, everyday controls, searchable advanced options, and collapsed credentials and technical details.
- **Connected tools and onboarding** — Categorized integrations and consistent setup, account, and error screens.
- **Reliable web builds** — Browser-safe core entry points prevent server-only dependencies from entering the web client bundle.

---

## v0.1.2 — 2026-06-18 {#v0-1-2}

Multi-account mail, inbox watcher, file attachments, integrations hub polish, managed inference fixes.

**Shipped**

- **Multi-account mail** — `mail_search_inboxes` scans every connected mailbox; `account_hint` on Gmail/Outlook compose and send; session `mail_account_context` persists the chosen mailbox across turns (rule **R-EMAIL-ACCOUNT**)
- **Connected mail only** — `mail_oauth_filter` ignores unconnected integrations and Entra `#EXT#` guest admin mailboxes; `list_connectors` shows **Connected mailboxes**
- **Email privacy** — `email_redaction` masks SSN, cards, phones, and addresses in summaries; `mail_search_inboxes` defaults `redact_sensitive: true` (rule **R-EMAIL-PRIVACY**)
- **Inbox watcher** — Background Gmail/Outlook polling with label support; automated receipt workflow hooks; capability gates for mail tools
- **File attachments** — Drag, drop, or paste any file into web and desktop composer; `chat_attachments` persists to `.agent_artifacts/uploads/` with limits (12 total: 4 images, 8 files)
- **Integrations hub** — Web `IntegrationCard` + per-account list; desktop provider rows, connection status, revoke account; `integrations_snapshot` and `revoke_integration_account` tools
- **Managed inference fix** — Settings **managed** mode no longer flips back to BYOK on Pro; sidecar skips BYOK auto-patch when user chose managed; regional Bedrock profile ids in desktop model picker
- **Email compose** — Expanded recipient guard, compose context/resume, Gmail compose guard tests; capability gates and long-horizon eval updates
- **Docs** — [Google Workspace](../guides/google-workspace.md), [Microsoft 365](../guides/microsoft-365.md), [Connectors](../guides/connectors.md)

---

## v0.1.1 — 2026-06-15 {#v0-1-1}

Desktop auto-update — harness hot-swap and app restart from GitHub Releases.

**Shipped**

- **Desktop auto-update** — Settings → About & updates; hub banner when a newer `v*-desktop` release exists
- **Harness hot-swap** — downloads `liminald-runtime-v{version}.zip`, stops sidecar, swaps `liminald/`, reconnects
- **App update** — downloads full platform archive, verifies SHA256, relaunches via bundled updater scripts
- **Release manifest** — `liminal-desktop-manifest-v{version}.json` on each desktop GitHub Release
- **CLI** — `liminal update --check`, `--json`, `--harness-only` for portable installs; git path unchanged
- **Docs** — [Install (desktop auto-update)](../start/install.md)

---

## v0.1.0 — 2026-06-15 {#v0-1-0}

First public preview release — stability milestone with CI, eval framework, latency optimization.

**Shipped**

- **CI workflow** — `.github/workflows/ci.yml` runs build, typecheck, and test on every push to main
- **Eval sandbox framework** — `packages/eval/fixtures/` sandbox scenarios; `npm run eval:sandbox` for reproducible agent tests
- **Inference latency mode** — `AGENT_LATENCY_MODE` patches for performance-optimized inference paths
- **Tool circuit** — `tool_circuit.ts` for parallel tool execution optimization
- **Kimchi constants** — Extracted `AGENT_KIMCHI_*` constants for Cast AI provider tuning
- **Desktop managed inference catalog** — Flutter UI for managed inference model selection
- **Sidecar multi-chat** — `chat_registry.ts` for multi-session support
- **Inference path validation** — `scripts/validate-inference-path.ts` for diagnosing routing issues
- **Release checklist** — `docs/RELEASE-CHECKLIST.md` documents the v0.1.0 release process
- **Docs** — [Running evals](../guides/running-eval.md), [Sandbox capability lab](../guides/sandbox-capability-lab.md), [Inference path validation](../reference/inference-path-validation.md)

---

## v0.0.26 — 2026-06-10 {#v0-0-26}

Live compose dock, email HTML preview, Azure ARM, Kimchi provider, OSC 133 shell.

**Shipped**

- **Compose dock** — `compose_preview` + streaming `tool_delta` open the right pane immediately on `write_file`/`edit_file`/Gmail/Outlook compose; content streams live and the panel persists through `turn_end`
- **Email HTML preview** — Extracts `<body>` fragments and sanitizes for `HtmlWidget`; fixes raw-HTML monospace preview during streaming
- **Azure ARM** — Subscription, resource-group, and location tools; per-resource `api-version` inference; clearer OAuth/ARM errors; guide in `docs/guides/azure.md`
- **Kimchi provider** — Cast AI rate-limit parsing, transient 400/429 retries, min request interval, throttle-aware circuit breaker; `AGENT_KIMCHI_*` in Settings
- **OSC 133 shell** — Prompt markers at PTY launch (`shell_integration_launch.ts`); `agent_shell_session` + `Osc133Tracker` for deterministic command-done events without prompt regexes
- **Provider backends** — Kimchi backend routing in `provider_backends.ts`; web/desktop Settings presets updated
- **Desktop WebView** — `desktop_webview_lifecycle.dart` pauses off-screen WebView2 instances to cut GPU/memory churn
- **Docs** — [Azure](../guides/azure.md), [Google Workspace](../guides/google-workspace.md)

---

## v0.0.25 — 2026-06-09 {#v0-0-25}

Desktop design system, Sheets auto-fit, integration arg reliability, research reply fix.

**Shipped**

- **Desktop design system** — Shared tokens, primitives (Button, Card, Badge), patterns (Sheet, EmptyState, SearchField), persona shells; wired through hub, home, chat panes, composer, and settings
- **Vireon hub** — Status strip, quick actions, mission control, searchable chat list, integration chips, two-column layout, pull-to-refresh
- **Chat UI** — Distinct user/assistant/tool/reasoning lanes (`chat_message_frame`, `reasoning_block`, `tool_category`); polished composer, drawer, message and tool activity tiles
- **Tool arg pipeline** — `prepareToolArgsForValidation` normalizes Google MCP, Google REST, and Linear args before schema validation; fixes Sheets `requests`/`data` JSON-string coercion and MCP HTTP 400 from hallucinated fields
- **Sheets auto-fit** — `AGENT_SHEETS_AUTO_FIT` (default on) resizes columns after value writes; empty spacer columns pinned narrow; `sheets_rest_auto_fit` for manual refit
- **User reply finalize** — `maybeRunUserReplyFinalizePass` runs one tool-free completion when a turn would end with tools/vault only; streams assistant text without fake user nudges (`AGENT_USER_REPLY_FINALIZE`)
- **Linear REST** — Expanded issue/project tools, `linear_resolve` helpers, and forgiving arg aliases
- **Docs** — Google Workspace + Linear guides updated for REST arg shapes and Sheets layout protocol
- **Docs** — [Google Workspace](../guides/google-workspace.md), [Linear](../guides/linear.md), [Desktop design system](../../apps/liminal_desktop/docs/design-system.md)

---

## v0.0.24 — 2026-06-09 {#v0-0-24}

Hosted OAuth connectors and desktop integrations hub.

**Shipped**

- **Hosted OAuth bridge** — `/connect/<provider>` begin + callback routes broker OAuth; desktop opens the flow and receives tokens on localhost callback
- **Seven connectors** — Google Workspace, Microsoft 365, GitHub, Slack, Linear, Notion, and Xero through the hosted bridge
- **Hosted token refresh** — Long-lived connections refresh access tokens server-side; secrets stay on Vireon
- **Custom GitHub website login** — vireondynamics.com sign-in via shared OAuth callback
- **Desktop integrations hub** — Connect, disconnect, and inspect providers from Liminal Desktop
- **Lazy connector tools** — Connector families stay off until a provider is linked
- **Docs** — [Connectors](../guides/connectors.md)

---

## v0.0.23 — 2026-06-07 {#v0-0-23}

Microsoft 365, styled email dock, lazy tools, Google REST hybrid.

**Shipped**

- **Microsoft 365** — Entra OAuth broker, `connect_provider({ provider: "microsoft_365" })`, MCP sidecar, Graph REST for Outlook send/draft, Teams, Planner, To Do, OneNote, OneDrive, Excel, SharePoint, and unified search; guide in `docs/guides/microsoft-365.md`
- **Google Workspace hybrid** — REST tools for Docs (`docs_rest_*`), Sheets, Slides, Calendar alongside existing Gmail MCP; styled HTML drafts via `gmail_create_draft` / `gmail_send_message` REST
- **GitHub connector** — `connect_provider({ provider: "github" })` with token/OAuth and MCP tool attach
- **Lazy tool loading** — `AGENT_TOOL_LAZY=1` default; `connectors` family activates on demand; persisted MCP connections no longer auto-register 300+ tools at boot (`AGENT_INTEGRATION_AUTO_ACTIVATE=1` opt-in)
- **OAuth mail routing** — Gmail preferred over Entra `#EXT#` guest admin mailboxes; `list_connectors` shows primary mail provider
- **Email composition** — `email_style_infer` sidecar, R-EMAIL-COPY / R-PRODUCT-TRUTH protocol rules, MIME mojibake repair + em-dash humanization, placeholder URL guard on send, Liminal product facts baked into system prompt
- **Desktop email dock** — Live HTML/plain preview while `gmail_*` / `outlook_*` tools stream; preview sanitization matches send path
- **Desktop shell** — Integrations screen, Vireon hub, orchestrator panel, chat pane with file + email compose rails
- **Sidecar orchestrator** — Worker handoff protocol, integrations snapshot API, orchestration status on wire
- **Web integrations** — Settings Integrations accordion for Google, Microsoft 365, and GitHub connect/disconnect
- **Docs** — [Microsoft 365](../guides/microsoft-365.md), [Google Workspace](../guides/google-workspace.md), [Tool families](../reference/tools/index.md)

---

## v0.0.22 — 2026-06-07 {#v0-0-22}

Serper search, agentcard, desktop browser dock; widget apps gated off.

**Shipped**

- **Serper web search** — `AGENT_WEB_SEARCH_PROVIDER` duckduckgo|serper with fallback; optional Serper fetch for `web_fetch`; dedicated `weather_fetch` path
- **Agentcard tools** — `agentcard` harness tools + CLI shim (`AGENT_AGENTCARD`); operator guide in `docs/guides/agentcard.md`
- **Gmail compose guard** — Preflight `gmail_send` for missing recipients/subject/body; expanded Google OAuth scope catalog
- **Desktop browser dock** — `AGENT_BROWSER_EMBED` streams `browser_view` snapshots to the Flutter shell; browser dock UI in chat
- **Default persona skip** — Bundled `persona/default` Liminal preset installs on bootstrap skip without LLM generation
- **Liminal widget apps (gated off)** — spawn_app/update_app stack in core/sidecar/tools/desktop ships disabled (`AGENT_LIMINAL_APPS=0`, `desktopAppsEnabled=false`) until widget stability improves
- **Desktop voice hardening** — Dictation TTS suspend/resume depth counter; incomplete portable `liminald` bundle detection in launcher
- **Docs** — [Liminal apps](../concepts/liminal-apps.md), [Agentcard](../guides/agentcard.md), [Web research](../guides/web-research.md)

---

## v0.0.21 — 2026-06-06 {#v0-0-21}

Plan progress UI, chat replay, desktop voice, persona UI v2.

**Shipped**

- **Plan progress UI** — One updatable Progress card per turn (web `PlanProgressBlock`, TUI `PlanCard`, desktop `PlanProgressTile`); `step_index` checkoffs no longer spawn empty Plan shells
- **Chat session replay** — `chat_session_replay` + `active_chat_state` hydrate transcripts from `.agent_sessions` JSONL on web, TUI, and sidecar multi-chat registry
- **Desktop voice** — Sidecar `/audio` HTTP for TTS/STT; Flutter dictation (VAD), composer mic, and `speech_output` playback; `docs/guides/voice.md`
- **Persona UI v2** — `persona_ui_copy`, `persona_ui_layout`, `persona_ui_invariants` in core; desktop persona chrome tokens and bootstrap polish
- **Provider hygiene** — `provider_token_scrub` strips leaked API keys from model output; OpenRouter routing and managed BYOK fallback refinements
- **Docs** — [Voice](../guides/voice.md), [Rich message rendering](../concepts/rich-message-rendering.md)

---

## v0.0.20 — 2026-06-06 {#v0-0-20}

Vault knowledge graph, desktop provider presets, managed-inference BYOK fallback.

**Shipped**

- **Vault knowledge graph** — `vault_ingest_entities` decomposes research into per-entity dossiers (Identity / Current / History / Relationships); `vault_ingest` auto-wikilinks; `vault_recall` GraphRAG neighborhood retrieval; `vault_lint` orphan repair; `AGENT_VAULT_ENTITY_EXTRACT` on by default for research auto-write
- **R-VAULT-ENTITIES** — Protocol cookbook for one canonical name per dossier, parallel `vault_write` batching, event+cast workflows; kind tags (`person`, `org`, …) on ingested entities
- **Managed inference fallback** — On HTTP 402 (credits exhausted), switch to OpenRouter BYOK on free `openrouter/owl-alpha` (`AGENT_MANAGED_FREE_FALLBACK`); preempt when wallet is already empty; honor explicit OpenRouter `baseURL` for BYOK presets
- **Desktop provider** — Settings provider-preset dropdown (Owl Alpha Stealth single-model, DeepSeek, etc.); `save_provider` allows model/baseURL-only saves; API key hydration from bundled `liminald/repo/.env` (`provider_api_key`)
- **Web Settings** — Provider presets sourced from `@liminal/core`; inference usage banner hints when managed credits are exhausted
- **Docs** — [Memory and vault](../concepts/memory-and-vault.md), [Managed inference](../guides/managed-inference.md)

---

## v0.0.19 — 2026-06-05 {#v0-0-19}

Desktop for macOS and Linux, GitHub Release downloads, install-page links.

**Shipped**

- **Liminal Desktop (all platforms)** — Release builds for **Windows x64**, **macOS arm64**, and **Linux x64**; `npm run desktop:build|package:macos|linux` plus existing Windows scripts; portable `liminald/repo` with **relative** paths in `bundle.json`
- **GitHub Releases** — Tag `v*-desktop` runs unified CI (Windows + macOS + Linux), uploads zip/tar.gz artifacts and SHA256 checksums
- **Install page** — [vireondynamics.com/liminal/get-started#desktop-app](https://www.vireondynamics.com/liminal/get-started#desktop-app) links direct downloads; product hero CTA points at the desktop app
- **CI fixes** — `tsc` builds without proprietary `@liminal/enterprise` on public clones; desktop bundle treats robocopy exit codes 0–7 as success
- **Docs** — [Rich message rendering](../concepts/rich-message-rendering.md), [Install (docs)](../start/install.md)

---

## v0.0.18 — 2026-06-04 {#v0-0-18}

Liminal Desktop (Windows), provider-routing recovery, reasoning-stall breaker, Gmail API tools.

**Shipped**

- **Provider routing recovery** — Dynamic `provider.ignore` list is capped and cleared when OpenRouter returns “all providers ignored” (404), so long ReAct runs do not stall mid-task after repeated upstream 429s
- **Reasoning-stall breaker** — Consecutive reasoning-only rounds (`think`/`reason`/`plan`/…) trigger a hard nudge, then temporarily drop reasoning tools so the model must call an action tool or finish
- **Liminal Desktop (Windows alpha)** — Flutter app (`apps/liminal_desktop`) talks to bundled `liminald` over `@liminal/protocol` WebSocket: multi-chat, Vireon sign-in, harness settings, compact tool cards, image attachments, GFM markdown + HTML embeds
- **Sidecar** — `@liminal/sidecar` serves session bridge, `/media` for workspace images, and `send_message` attachments; `npm run desktop:build:windows` bundles Release + liminald
- **Gmail** — Native `google_gmail_*` tools (read/search) with proper body decoding; Google MCP probe documents separate Gmail API enablement
- **Rich message rendering** — Spec in `docs/concepts/rich-message-rendering.md`; desktop parity with web for alerts, code highlight, video embeds, streaming HTML fences
- **Docs** — [Rich message rendering](../concepts/rich-message-rendering.md), [Managed inference](../guides/managed-inference.md), [Google Workspace](../guides/google-workspace.md)

---

## v0.0.17 — 2026-06-02 {#v0-0-17}

Team shared memory, Pro cloud sync APIs, NotesFacade in CE, and org-scoped control-plane storage.

**Shipped**

- **Team shared memory** — `team.shared_memory` entitlement drives org-scoped note replication keyed by `org_id` + `workspace_fingerprint`. Workspace and global notes sync across teammates; chat-scoped notes stay local-only (API + ranker enforced). Enterprise Edition pulls before round 0 and pushes after `turn_end` when `AGENT_TEAM_MEMORY_SYNC=1`
- **Control plane** — `GET/PUT /api/team/memory/notes`, status, optional SSE bus (`/api/team/bus/*`), Pro user notes/vault sync (`/api/pro/cloud_sync/*`), session history upload, org tables + Team checkout creates org owner, invite flow with seat limits
- **CE contracts** — `NotesFacade`, `StoredNote` org fields (`userId`, `orgId`, `revision`), `runWithOrgContext`, harness hooks `onTurnStartMemorySync` / `onTurnEndMemorySync` / `onRecallMerge`, `AGENT_TEAM_EMBED_ON_RECALL` to avoid full-store embedding on recall
- **Web Settings** — Team memory status + org id on `/api/vireon/account` and in the Settings modal
- **Dev** — `AGENT_CONTROL_PLANE_URL` for local EE sync against `:3002`; changelog now generated from `changelog/releases.json` (`npm run changelog:gen`)
- **Docs** — [Team memory](../guides/team-memory.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Enterprise Edition](../reference/enterprise-edition.md)

---

## v0.0.16 — 2026-06-02 {#v0-0-16}

Managed inference for Pro, Vireon sign-in, dynamic OpenRouter routing, EE auto-install, security hardening.

**Shipped**

- **Managed inference (Pro)** — Chat, embeddings, vision, and audio sidecars can route through Vireon's metered OpenAI-compatible proxy (`AGENT_INFERENCE_MODE`: `auto` | `managed` | `byok`; default `auto`). Pro sign-in prefers managed routing with included monthly credits and a clear top-up path when budget is exhausted. Community Edition stays bring-your-own-key with no account
- **Vireon sign-in** — `liminal login` (loopback browser flow) or **Settings → Sign in** stores the license under `~/.liminal/`; no `.env` API-key paste for Pro managed mode
- **Dynamic OpenRouter routing** — Price-sorted provider selection (`AGENT_PROVIDER_STRATEGY`), sticky `session_id` for KV-cache affinity (`AGENT_OPENROUTER_SESSIONS`), and session-epoch rotation on upstream 429s (`adaptive` strategy) so rate limits do not stall long runs
- **Enterprise Edition auto-install** — Pro+ login downloads the proprietary EE bundle to `~/.liminal/enterprise/` (checksum-verified); implementations stay out of the public CE repo while gating cloud/team entitlements
- **Security hardening** — Control-plane rate limiting and auth hygiene, web API token gate bound to loopback, tighter guards on `run_shell` and `execute_code`
- **Inference UX** — Web inference usage/credits banner; steadier sign-in polling for managed sessions
- **Dictation & ASR defaults** — Default `AGENT_TRANSCRIBE_MODEL` is `nvidia/parakeet-tdt-0.6b-v3` (English + EU); `AGENT_DICTATION_WEB_SPEECH=0` keeps browser Web Speech off so dictation transcribes **server-side** only (no Chrome→Google path). Web `/api/config` exposes the toggle
- **Docs** — [Managed inference](../guides/managed-inference.md), [Accounts & licensing](../guides/accounts-and-licensing.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Voice I/O](../guides/voice.md)

---

## v0.0.15 — 2026-05-31 {#v0-0-15}

Open-core licensing, Vireon control plane, Enterprise Edition package, dynamic workflows.

**Shipped**

- **Open-core entitlements** — Offline-verifiable license tokens (Ed25519; harness holds public key only). Verified licenses cache to `~/.liminal/license.json` with bounded offline grace. Community Edition needs **no license** — full harness on your machine
- **License tiers** — `community` · `pro` · `team` · `enterprise` (each inherits below). Tiers gate cloud/sync/governance features by entitlement key, not core agent capability
- **Vireon control plane** — `@liminal/control-plane`: Stripe subscriptions + webhooks, Supabase entitlements, signed license issuance (deploy beside [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website))
- **Enterprise Edition package** — Proprietary Pro/Team/Enterprise implementations in a separate package; CE repo stays fully functional without EE installed
- **Dynamic workflows** — `plan_workflow` → `run_workflow` execute a declarative multi-phase spec: bounded concurrency waves per phase, per-agent results in an out-of-context store (`.agent_workflows/`), distilled phase summaries back to parent context only. Root-only, approval-gated (`AGENT_WORKFLOWS`). Intent classifier can auto-activate the `workflow` tool family under lazy loading
- **Docs** — [Dynamic workflows](../guides/dynamic-workflows.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Enterprise Edition](../reference/enterprise-edition.md)

---

## v0.0.14 — 2026-05-30 {#v0-0-14}

LLM memory curator, output-effort dial, voice I/O, retrieval reranker, deeper prompt caching.

**Shipped**

- **Memory curator** — `curate_memory` (dry-run by default) sends a metadata-annotated slice of the note store to the model, which returns prune / merge / re-confidence ops; a deterministic safety-rail veto then protects `user:`/`identity:`/`pref:` keys, high-access, and too-young notes. Deletion is **reversible**: `forget` and the curator soft-delete the full note to `notes.archive.json` (`AGENT_MEMORY_ARCHIVE`) before removing; `restore_memory` recovers it. Tunables: `AGENT_CURATOR_TIMEOUT_MS`, `AGENT_CURATOR_MAX_TOKENS`, `AGENT_CURATOR_PROTECT_GLOBAL` (off — `global` is the default scope, not a durability signal)
- **Output effort** — `AGENT_EFFORT` (`low` | `medium` | `high` | `xhigh`) — a deliverable-thoroughness dial injected as a system-prompt directive (rule **R-EFFORT**), exposed as a Settings dropdown. A separate axis from reasoning: it scales completion budget and output completeness/coverage, not internal `think()`/`reason()` depth
- **Voice I/O** — Text-to-speech (`speak`, Kokoro / OpenAI voices, per-turn budget + near-duplicate suppression) and live microphone **dictation** in the web UI; voice-mode tool gating. See [Voice I/O](../guides/voice.md)
- **Retrieval** — Second-stage recall reranker over first-stage BM25 + embedding hits; fast-model JSON response cache to cut repeat sidecar calls
- **Prompt cache** — Rolling `cache_control` breakpoint over conversation history (`AGENT_PROMPT_CACHE_ROLLING`) plus volatile-tail context ordering (`AGENT_CTX_VOLATILE_TAIL`), so the cache extends across accumulated tool-result history, not just the static prefix
- **File tools** — `find_files` (path/name glob) and `delete_file` (approval-gated); a catalog reachability test guards against tools unreachable under lazy loading
- **Chat UX** — Markdown renderer for assistant output, session screenshot export, persona shell refactor (Hud / Minimal / Studio / Terminal / Composer)
- **Web** — Greeting fires on reload without blocking, SSE reconnect robustness; OpenRouter `session_id` on chat completions for request grouping
- **Reliability** — More reliable long `write_file` paths and HTML chunk guards

---

## v0.0.13 — 2026-05-28 {#v0-0-13}

**Shipped**

- **Provider model presets** — One-click OpenRouter packs in web Settings (main + fast slots, provider order pins); DeepSeek, Claude 4.7, GPT 5.5, Gemini 3.5, Qwen 3.6, MiMo, Llama 4, Kimi, GLM, and cross-vendor mixes; slugs verified against OpenRouter `GET /models`
- **Settings completeness** — Full harness env catalog in the web Settings modal with field metadata (aligned with `HARNESS_ENV_DEFAULTS`)
- **Turn end** — Simpler end-of-turn pipeline on `send()` (less redundant work)
- **Repo** — Removed experimental Android app scaffold and `mobile-contract` package

---

## v0.0.12 — 2026-05-26 {#v0-0-12}

Research ledger, identity memory, FSL relicense, web chat chrome polish.

**Shipped**

- **Research ledger** — Per-`send()` tracking of `web_search` / `web_fetch` (queries, surfaced URLs, fetch outcomes, deduped URLs); compact context injection each round; harness tool `research_state` (summary / pending / fetched / failures views)
- **Identity memory** — Intent `identityQuery` / `identityProvision`; LLM-generated recall queries; on-disk scan of `user:` / `identity:` / `pref:` notes; auto-`remember` with `scope: global` for `user:name`; protocol reminder not to use OS username as display name
- **Recall fix** — `recall_relevant` accepts `query` or `queries`
- **Web UI** — Chat switcher embedded in each persona shell header row; portaled dropdown + click-outside dismiss
- **PASTE** (optional) — Predictive tool-call speculation (`AGENT_PASTE_*`, off by default)
- **License** — **FSL-1.1-MIT** (MIT Future) across the harness; compliance documentation expanded; fair-source framing on marketing/install
- **Reliability** — `write_file` integrity check fix for apostrophes inside comments

---

## v0.0.11 — 2026-05-24 {#v0-0-11}

User-global storage, web multi-chat, audio transcription, and connector tools.

**Shipped**

- **Storage layout** — `~/.liminal/` user-global memory, persona, prefs, vault; per-chat folders for sessions/artifacts; `AGENT_STORAGE_LAYOUT=legacy`
- **Web multi-chat** — `ChatManager`, chat list/switch APIs, idle bridge eviction, SSE scoped to the active chat
- **Audio** — `transcribe_audio`, upload attachments, OpenRouter Whisper defaults, dictation env knobs, web mic UI
- **API connectors** — `api_connect` / `api_disconnect` / `api_list` (OpenAPI → dynamic tools, persisted connections)
- **MCP** — `mcp_attach` to wire MCP servers into the live registry
- **Memory** — `memory_promote`, `memory_neighbors`, `consolidate_chat`; federated rank scoring; exploratory-turn debias (`AGENT_MEMORY_DEBIAS`, optional `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL`)
- **Harness** — `AGENT_PROMPT_CACHE` (provider cache breakpoints); intent inference heuristics + research finalize judge; vault index helper
- **Docs** — [Roadmap](./roadmap.md)

---

## v0.0.10 — 2026-05-23 {#v0-0-10}

Task Worlds landed earlier on May 23 then was removed the same day in favor of execution state and compensation wiring.

**Shipped**

- `liminal` CLI (dev) — `setup`, `doctor`, `web`, `tui`, `update`, `path`
- Install scripts: `scripts/install.sh`, `scripts/install.ps1`
- Recipe library v2 — compounds on strategy shape, not generic `recipe:` notes
- Harness power pass — execution state, compensation playback, `breakdown`, tool DAG `depends_on`, contract→tool mapping
- Workflow evals + additional core baseline tests
- Web fetch — Wikipedia extracts, pagination, distill bypass, model `max_chars` floor
- Persona UI themes — distinct palettes, HudShell theme wiring
- Per-harness workspace root, streaming edit previews in web

---

## v0.0.9 — 2026-05-22 {#v0-0-9}

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, license file (later FSL), compensation ledger.

**Shipped**

- **Streaming large-file writes** — `.agent_write_staging/`, manifest resume after truncation; write integrity nudges; legacy patch tools removed
- **Compensation ledger** for partial plan rollback; session tool-output index; outcome scoring; optional self-heal lint
- **Intent classification** and **reasoning budget** (effort + think-depth per turn); external `think()` + `reason()` surface; two-tier main/fast models; effort learning
- **Playwright browser** family + stealth; **CAPTCHA** solving (2captcha / CapSolver)
- **Document engine** — compose → lint → repair → PPTX / DOCX / PDF export with quality gate
- `self_telemetry`, `rename_symbol`, `git_worktree`; recipe library redesign; Settings catalog + provider presets in web UI
- MIT `LICENSE` file at this milestone (superseded by FSL-1.1-MIT in v0.0.12)

---

## v0.0.8 — 2026-05-15 {#v0-0-8}

Harness defaults + web Settings, Obsidian vault discovery, persona bootstrap/themes, orchestration expansion.

**Shipped**

- **`HARNESS_ENV_DEFAULTS`** typed module (~190 keys); web **Settings** modal with field metadata and provider presets
- **Obsidian vault auto-discovery** from `obsidian.json`; web_fetch wall-clock budget + readability worker
- Removed **`web_research`** tool → `web_search` + parallel `web_fetch`
- Persona generator, bootstrap modal (TUI + web), **PersonaUiTheme** + web shell router, personality heartbeat (off by default)
- Expanded harness lifecycle hooks; orchestration catalog growth; VitePress docs restructure

---

## v0.0.7 — 2026-05-12 {#v0-0-7}

World context, session JSONL, platform context, agenda/scheduler, auto-dream telemetry.

**Shipped**

- **World context** gatherers + **harness rule recall** at round 2; **runtime prefs** (`.agent_runtime_prefs.json`); **platform context** (OS, shell, git, ports, terminal snapshots)
- **Agenda / scheduler / synthesis / independence** tool family; web_fetch readability improvements
- **Session JSONL** — rollup / delta / trace modes under `.agent_sessions/`; provider pacing gate; auto-dream scanner telemetry in web UI
- TUI/web session metrics; **runtime settings** tools; experimental Android chat scaffold (later removed)

---

## v0.0.6 — 2026-05-10 {#v0-0-6}

Unified file edits, research credibility tiers, dynamic tools, MCP client.

**Shipped**

- **`write_file` + `edit_file`** canonical surface; **`grep_file`** always-on
- **Source credibility tiers** and contradiction surfacing in research rules
- **Dynamic tools** persisted to disk; **MCP client**; progress events for long-running tools
- SSE reconnect hardening; provider retry lines visible in UI

---

## v0.0.5 — 2026-05-09 {#v0-0-5}

Upgrade V — shared memory bus, tool DAG, semantic compression, goal/branch tools.

**Shipped**

- **Shared memory bus**; spaced-repetition decay in `memory_rank`
- **TaskOrchestrator DAG** with `depends_on`; **semantic compression** for context
- `decompose_goal`, `branch_explore`, `verify_contract`; plugin loader; adaptive protocol suffix

---

## v0.0.4 — 2026-05-08 {#v0-0-4}

Vision sidecar, markets quotes, self-heal lint, document engine scaffold.

**Shipped**

- **Vision sidecar** (`vision_analyze`); **markets_quote** multi-source
- **Self-heal lint** loop (off by default); **document engine** scaffolding (`doc_*` family begins)
- Streaming resilience; long-horizon autonomy hooks; expanded file operations

---

## v0.0.3 — 2026-05-05 {#v0-0-3}

Lazy tool families, hybrid recall, safety judge, workspace-root grounding.

**Shipped**

- **Tool argument guard**; vault path resolution; **workspace-root grounding**
- **Safety judge** optional pre-flight; **hybrid recall** (BM25 + embeddings)
- **Lazy tool loading** — `list_tool_families` / `activate_tool_family`
- README + architecture diagram fixes

---

## v0.0.2 — 2026-05-03 {#v0-0-2}

Dynamic persona generation, child harness wiring.

**Shipped**

- LLM-generated personas with strength dial and modifiers
- **`onChildCreated`** child harness tool registration; resource lock caps on persona tooling

---

## v0.0.1 — 2026-05-03 {#v0-0-1}

Monorepo scaffold, AgentHarness, tools, TUI, web, eval, Liminal rebrand.

**Shipped**

- Workspaces: `packages/core`, `tools`, `tui`, `web`, `eval`
- **AgentHarness** ReAct loop, approvals, context manager
- Initial tools: files, shell, git, memory, web, `think` / `plan` / `reason`
- Ink TUI + Express/React web with SSE; first eval scenarios

---

## Planned (not started)

See the full [Roadmap](./roadmap.md) for what each milestone means.

| Stage | Target | Status |
|-------|--------|--------|
| Beta | Stability + defaults freeze candidate | Not started |
| RC | Ship checklist, docs freeze | Not started |
| v0.1.0 | Public preview tag + install GA | Not started |

---

**Commits on `main`:** [github.com/traidy2222/liminal-ai/commits/main](https://github.com/traidy2222/liminal-ai/commits/main)
