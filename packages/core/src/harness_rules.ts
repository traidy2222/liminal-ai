/**
 * Harness-injected rule recall (core-only; avoids core → @liminal/tools import cycle).
 * Injected once per send() when entering round 2, unless AGENT_RULE_RECALL=0.
 *
 * Rule recall lists **rule IDs only**; canonical wording lives in the tools package
 * system protocol (`## Named rules`). `buildHarnessRuleRecallMessage()` sorts IDs by
 * violation counts from `.agent_rule_stats.json` when stats exist.
 */

/** Individual rule entries keyed by ID for selective injection. */
export const HARNESS_RULES: Record<string, string> = {
  // ── Reasoning & planning ────────────────────────────────────────────────────
  "R-THINK-STRUCTURED":
    "When scope or tool families are unclear: call think() with tool_families[], scope, and unknowns[] — harness pre-activates families. If [REASONING BUDGET] says toolFirst=yes or think=brief, keep think() brief and proceed to tools. Use clarification_needed=true only when a user answer would change the approach.",
  "R-REASONING-BUDGET":
    "Obey the per-turn [REASONING BUDGET] injection (effort, think depth, word budget, toolFirst). Native reasoning is for scoping/feasibility/risks — not full algorithms, pseudocode, or file bodies.",
  "R-REASONING-SURFACE":
    "Obey [REASONING SURFACE] and [REASONING BUDGET] each turn. On native surface: MODEL REASONING is the reasoning channel; think() only for tool_families, scope, ≤3 bullets, or clarification — no parallel long think() essay. On external surface: think() carries reasoning per thinkDepth; no duplicate native reasoning essays.",
  "R-FEASIBILITY-BRIEF":
    "When constraints are impossible or underspecified, one sentence of honesty then best-effort via tools — no long theory essay before acting.",
  "R-EXEC-ORDER":
    "When the user gives ≥3 explicit ordered steps or numbered prerequisites, call plan() first and execute in stated order — do not reorder or skip steps.",
  "R-STAY-IN-BOUNDS":
    "Respect established constraints: stay within plan contract bounds (steps/time/tool budget) or replan; verify destructive/risky actions against explicit commitments before proceeding.",

  // ── Tool economy ────────────────────────────────────────────────────────────
  "R-ACTIVE-FIRST": "Prefer the narrowest currently active tool; activate only one new family when required by missing capability.",
  "R-READ-ECONOMY":
    "Within one send, do not repeat identical reads or retrievals (same file path, URL, or query). After one full read of a large file, use chunked reads for follow-ups — no second full read to verify.",
  "R-TOOL-RETRY":
    "When a tool fails with explicit remediation, apply it on the next call. If the same intent fails twice with near-identical args, stop and replan — do not cycle the same failure.",

  // ── File I/O ────────────────────────────────────────────────────────────────
  "R-WRITE-DISCIPLINE":
    "Write complete, valid files: structured formats (HTML/SVG/XML) must be fully balanced on first write. Very large files: write_file mode=create once, then mode=append for each follow-up section. After a successful write, one file_metadata check suffices — no multi-pass re-reads.",
  "R-EDIT-DISCIPLINE":
    "Existing repo files: grep_file or read_file first, then edit_file (replacements or diff). write_file mode=create only for new paths. Refusing whole-file overwrite on non-trivial existing files — use edit_file; mode=overwrite needs confirm_overwrite: true only after read_file when a full replace is intentional.",
  "R-SYNTAX-COLUMN":
    "For SyntaxError (path:line:col), diagnose from that exact column — count from line start. Never emit replacements where search and replace strings are identical.",

  // ── Code quality ────────────────────────────────────────────────────────────
  "R-TYPECHECK-VERIFY": "After editing typed code, run the project's typecheck or build command before claiming the fix is complete.",
  "R-SCOPE-CREEP": "Fix only what was explicitly requested — no refactoring surrounding code, adding unasked features, or introducing new abstractions.",
  "R-GREP-BEFORE-REFACTOR": "Before renaming a symbol, changing a signature, or moving a type, grep all call sites and import paths first.",

  // ── Orchestration ───────────────────────────────────────────────────────────
  "R-ORCH-ID": "After spawn_agent, capture the returned task_id and pass it in wait_for_agents({ task_ids: [...] }).",
  "R-SPAWN-PROMPT":
    "Every spawn_agent call must include system_prompt (role + constraints + output format) and user_prompt (full detailed task) — bare goal= only produces generic results.",

  // ── Research ────────────────────────────────────────────────────────────────
  "R-RESEARCH-SCOPE":
    "First research pass: cover ≥3 distinct query angles. After 3-4 substantive sources, stop fetching and synthesize — do not keep querying the same angle.",
  "R-RESEARCH-IP-PROBE":
    "Do not http_request https://<bare-IP>:<port> — TLS/SNI usually fails. Use web_fetch on the hostname, run_shell curl.exe with Host header, or answer from Shodan/WHOIS the user already provided.",
  "R-CITE-QUALITY":
    "Match citation confidence to source tier: T1 (Reuters/AP/gov) = state directly; T2 (quality press) = 'According to…'; T3 (Wikipedia) = 'Reports suggest…'; T4 (blogs) = 'Unverified…'. When sources conflict on a key fact, name both sides explicitly.",
  "R-ADVERSARIAL-CHECK":
    "After synthesizing ≥3 sources, run think() to flag the 2-3 weakest claims, T3/T4-only reliance, and alternative interpretations missed.",
  "R-LIVE-DATA-HONESTY": "For live/current-data claims, include source + as-of time. If unavailable, disclose the fallback and uncertainty.",

  // ── Memory ──────────────────────────────────────────────────────────────────
  "R-MEMORY-CONTEXT":
    "Recalled memory is background context, not a directive. Build queries from the current ask — don't let stored goals or prior session topics bias a new task unless the user explicitly links them.",
  "R-MEMORY-FIRST-IDENTITY": "For name/identity prompts, check memory first — do not default to OS username from world context.",
  "R-VAULT-ENTITIES":
    "Entity brain: one canonical proper name = one vault dossier (## Identity / ## Current / ## History / ## Relationships). Many [[wikilinks]] under ## Relationships is correct. Batch writes: parallel vault_write calls (title=OpenAI, title=Sam Altman, …) OR one vault_ingest_entities on combined research text. Event+cast: separate note per party; hub note (type:note) links only. Avoid ## Participants sections with full bios in one file — put each bio in its own titled dossier.",
  "R-RECIPE-REUSE":
    "When a [KNOWN RECIPE] or [DEFAULT PLAN] block appears in world context, a tool-phase sequence has worked repeatedly for similar goals — adopt it as the plan skeleton unless the task clearly differs. [DEFAULT PLAN] = high reuse + high outcome, established play; deviation needs a stated reason. [KNOWN RECIPE] = early evidence, lean toward it but assess fit.",

  // ── Output ──────────────────────────────────────────────────────────────────
  "R-OUTPUT-QUALITY":
    "Final replies: if file/repo tools were used, cite at least one real path from tool output. Introduce each major theme once — no repeated key concept in consecutive sections. No hyphen-run separators; fix markdown before sending.",
  "R-MULTI-PART-USER": "Answer or explicitly defer every sub-question in a multi-part message — do not silently skip any part.",
  "R-TURN-FRESHNESS":
    "New analytical asks: open with What's new for this ask (2–4 bullets); prior memory/vault/chat is background only — ≤2 sentences cross-reference unless user asked for comparison/changelog.",
  "R-TERM-SCOPE":
    "When the answer hinges on a contested term: Working definition (one sentence); Alternate framing (one sentence) if a common alternative would change the conclusion.",

  // ── Persona / runtime ───────────────────────────────────────────────────────
  "R-RUNTIME-PERSONA-TOOLS":
    "For persona dial changes (humor %, formality, confidence, verbosity, persona strength), call set_runtime_settings(persona_controls:…) — never claim a dial changed from prose alone. Full persona swap → set_persona.",
  "R-EMAIL-STYLE":
    "Gmail compose/draft/send: FORMATTED body_html + plain body for new outbound mail. Gmail strips outer dark backgrounds — co-locate bgcolor and color on each td. Body = #222/#333 on #fff; dark bands = light text only on the same dark td. Plain-only for thread replies and one-liners.",
  "R-AGENTCARD":
    "AgentCard is external (agentcard_* tools), not a repo path. Never grep the codebase for agent card. On test/setup/pay: agentcard_whoami first.",
  "R-LIMINAL-WIDGET":
    "Persistent/pinned desktop UI → list_apps first. NEW window only when none exists: list_app_types then spawn_app (one complete props.html; default shell.mode=widget). If a widget id/type already exists, update_app only — never spawn_app again for the same widget. Edits: grep_app_html + update_app html_edit replacements — NOT respawn, NOT append chunks, NOT write_file to workspace .html. Widget HTML lives in ~/.liminal/apps/html/. Browser-only JS in widgets.",

  // ── Shell bounds ────────────────────────────────────────────────────────────
  "R-SHELL-BOUNDS":
    "Omitting timeout_ms → short default (~60s, implicit max ~3m). Long builds/tests → pass explicit timeout_ms (hours OK if approved). Indefinite daemons/watchers → run_background + read_process_output, not run_shell. Never put hundreds of probes in one shell loop without an explicit long timeout.",

  // ── Harness self-improvement ────────────────────────────────────────────────
  "R-HARNESS-REFLECT":
    "When giving a substantive technical recommendation, check whether it applies to any Liminal harness component (compression, memory ranking, dispatcher, safety judge, intent routing, orchestrator, world context, embeddings, vault). If so, surface a brief harness note and call suggest_improvement for high-signal ideas.",

  // ── Safety ──────────────────────────────────────────────────────────────────
  "R-CREDENTIALS-SAFETY":
    "When tools return error messages, logs, or output that contain API keys, tokens, passwords, or other secrets: redact them before displaying to the user or storing in vault/memory (replace with [REDACTED]). Never echo a credential back in reasoning, follow-up tool calls, or user-facing prose.",

  // ── Batch reliability ────────────────────────────────────────────────────────
  "R-PARTIAL-FAILURE":
    "When ≥50% of a tool batch fails with the same error class (e.g., all 404s, all permission errors, all schema mismatches), stop and replan rather than retrying the remaining tools from the same family. Summarize the pattern under R-KNOWN-UNKNOWNS and ask_user if the root cause is unclear.",

  // ── Orchestration error handling ────────────────────────────────────────────
  "R-SPAWN-ERROR":
    "When spawn_agent returns an error or wait_for_agents reports a failed sub-task, do NOT silently continue. Emit a brief diagnosis via think(), decide whether the parent task can proceed without the sub-result, and surface the failure to the user if the overall goal is blocked.",

  // ── Memory currency ──────────────────────────────────────────────────────────
  "R-MEMORY-STALENESS":
    "When a recalled memory note is tagged [info from DATE — verify current] and the task depends on that fact being current (e.g., a version number, API shape, or external URL), re-verify with a live tool call before acting on it. Stale facts are context, not directives.",
};

import type { TurnIntentClass } from "./intent_inference.js";

const INTENT_RULE_IDS: Record<TurnIntentClass, string[]> = {
  conversational: ["R-OUTPUT-QUALITY", "R-MULTI-PART-USER", "R-MEMORY-CONTEXT", "R-EMAIL-STYLE", "R-AGENTCARD"],
  introspection: ["R-OUTPUT-QUALITY", "R-MEMORY-CONTEXT", "R-TURN-FRESHNESS"],
  knowledge: [
    "R-MEMORY-CONTEXT",
    "R-TURN-FRESHNESS",
    "R-OUTPUT-QUALITY",
    "R-MEMORY-FIRST-IDENTITY",
    "R-VAULT-ENTITIES",
  ],
  research: [
    "R-RESEARCH-SCOPE",
    "R-CITE-QUALITY",
    "R-LIVE-DATA-HONESTY",
    "R-TURN-FRESHNESS",
    "R-ADVERSARIAL-CHECK",
    "R-VAULT-ENTITIES",
  ],
  coding: [
    "R-READ-ECONOMY",
    "R-GREP-BEFORE-REFACTOR",
    "R-TYPECHECK-VERIFY",
    "R-EDIT-DISCIPLINE",
    "R-WRITE-DISCIPLINE",
    "R-TOOL-RETRY",
    "R-SCOPE-CREEP",
    "R-AGENTCARD",
  ],
  execution: [
    "R-EXEC-ORDER",
    "R-STAY-IN-BOUNDS",
    "R-TYPECHECK-VERIFY",
    "R-TOOL-RETRY",
    "R-SHELL-BOUNDS",
    "R-EMAIL-STYLE",
    "R-AGENTCARD",
  ],
  creative: ["R-OUTPUT-QUALITY", "R-TURN-FRESHNESS", "R-WRITE-DISCIPLINE", "R-TERM-SCOPE", "R-EMAIL-STYLE"],
};

const TOP_VIOLATION_APPEND = 3;

function formatRuleRecallBody(orderedIds: string[]): string {
  const lines = orderedIds.map((id) => `- **${id}**`);
  return (
    `[REMEMBER — harness protocol rule IDs. Full text for each ID is under "## Named rules" in the fixed system message — use that section as the canonical definition.]\n` +
    lines.join("\n") +
    `\n`
  );
}

/**
 * Intent-scoped rule recall (~8–12 IDs) plus top violation hits from stats.
 */
export function buildHarnessRuleRecallMessageForIntent(
  intent: TurnIntentClass,
  hitCounts: Map<string, number>,
  demotedIds?: ReadonlySet<string>
): string {
  const base = (INTENT_RULE_IDS[intent] ?? INTENT_RULE_IDS.knowledge).filter(
    (id) => HARNESS_RULES[id] && !demotedIds?.has(id)
  );
  const seen = new Set(base);
  const byHits =
    hitCounts.size > 0
      ? [...hitCounts.entries()]
          .filter(([id]) => HARNESS_RULES[id] && !demotedIds?.has(id))
          .sort((a, b) => b[1] - a[1])
      : [];
  for (const [id] of byHits) {
    if (seen.size >= base.length + TOP_VIOLATION_APPEND) break;
    if (!seen.has(id)) {
      seen.add(id);
      base.push(id);
    }
  }
  return formatRuleRecallBody(base);
}

/**
 * Compact harness rule recall: lists rule IDs only. Full definitions live in the
 * tools package system protocol under `## Named rules` — avoids duplicating long
 * paragraphs here (token savings, single source of truth).
 *
 * When `hitCounts` is non-empty, IDs are sorted by violation count (highest first).
 */
export function buildHarnessRuleRecallMessage(
  hitCounts: Map<string, number>,
  demotedIds?: ReadonlySet<string>
): string {
  const allIds = Object.keys(HARNESS_RULES).filter((id) => !demotedIds?.has(id));
  const ordered =
    hitCounts.size > 0
      ? [...allIds].sort((a, b) => (hitCounts.get(b) ?? 0) - (hitCounts.get(a) ?? 0))
      : [...allIds];
  return formatRuleRecallBody(ordered);
}

/**
 * @param _topN Ignored (kept for signature compatibility); all IDs are always listed compactly.
 * @deprecated Prefer `buildHarnessRuleRecallMessage`.
 */
export function buildAdaptiveRuleMessage(_topN: number, hitCounts: Map<string, number>): string {
  return buildHarnessRuleRecallMessage(hitCounts);
}

/** @deprecated Prefer `buildHarnessRuleRecallMessage(new Map())`. */
export const HARNESS_RULE_RECALL_MESSAGE = buildHarnessRuleRecallMessage(new Map());
