import type { ToolRegistry } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { TOOL_FAMILIES, countCatalogFamilies, countCatalogToolNames } from "../tool_catalog.js";

/** Unique tool names declared across TOOL_FAMILIES (catalog baseline; runtime may add dynamic tools). */
export { countCatalogToolNames, countCatalogFamilies };

export interface HarnessProductFactsOptions {
  /** Live registry total when available; falls back to catalog count. */
  registeredTotal?: number;
  activeTotal?: number;
  lazyMode?: boolean;
}

/** Authoritative Liminal product + capability line — counts derived from catalog/registry, not hand-maintained. */
export function buildHarnessProductFacts(opts: HarnessProductFactsOptions = {}): string {
  const catalogTools = countCatalogToolNames();
  const familyCount = countCatalogFamilies();
  const registered = opts.registeredTotal ?? catalogTools;
  const active =
    opts.activeTotal !== undefined ? `; ${opts.activeTotal} active this session` : "";
  const lazy =
    opts.lazyMode !== undefined
      ? opts.lazyMode
        ? " Lazy loading on — see TOOL CAPABILITY MANIFEST below for active vs inactive tools."
        : " All registered tools are active."
      : "";
  const interfaces = buildHarnessInterfaceSurfaces();
  return (
    `**Liminal product facts** (authoritative for outreach, bios, and repo links — memorize these):\n` +
    `- Product: Liminal — fair-source local-first AI agent harness\n` +
    `- Company: Vireon Dynamics (Australia)\n` +
    `- Repo: https://github.com/traidy2222/liminal-ai\n` +
    `- Website: https://www.vireondynamics.com/liminal\n` +
    `- Docs: https://docs.vireondynamics.com/liminal/\n` +
    `- License: FSL-1.1-MIT (Community Edition)\n` +
    `- Tool catalog: ${registered} registered tools across ${familyCount} families${active}.${lazy}\n` +
    `- Surfaces: ${interfaces}\n` +
    `- Stack: AgentHarness ReAct loop, approval-gated writes, typed memory + Obsidian vault, multi-agent orchestration, scenario eval packs\n` +
    `Never cite \`GITHUB_USERNAME\`, \`REPO_PLACEHOLDER\`, \`example.com\`, or invented URLs for this project.\n` +
    `**Outbound mail about Liminal:** call \`list_connectors\` for the connected sending mailbox; recall memory / vault for the user's name and sign-off.\n` +
    `Live tool names and family activation state: **TOOL CAPABILITY MANIFEST** in the protocol suffix (refreshed when families activate).`
  );
}

/** Human-readable UI surfaces for this process (desktop when sidecar/desktop apps are on). */
export function buildHarnessInterfaceSurfaces(): string {
  const surfaces = ["terminal UI (TUI)", "web chat"];
  const desktop =
    effectiveHarnessEnvRaw("AGENT_LIMINAL_APPS_DESKTOP") === "1" ||
    process.env["LIMINAL_SIDECAR"] === "1" ||
    process.env["LIMINAL_DESKTOP"] === "1";
  if (desktop) surfaces.push("desktop shell (sidecar + native widgets)");
  return surfaces.join(", ");
}

/** Map registered tool names → compact capability-domain summary (persona generation, intros). */
export function buildHarnessCapabilityDomains(toolNames: string[]): string {
  const has = (re: RegExp) => toolNames.some((n) => re.test(n));
  const cats: string[] = [];
  if (has(/^(read_file|write_file|edit_file|list_dir|multi_file_apply|move_file|copy_file|mkdir_p)/))
    cats.push("file read/write");
  if (has(/^(run_shell|run_background|kill_process|list_processes|read_process_output)/))
    cats.push("shell execution");
  if (has(/^(web_search|web_fetch)/)) cats.push("web search + live fetch");
  if (has(/^(remember|recall\b|recall_type|recall_relevant|search_memory|memory_query|memory_consolidate)/))
    cats.push("persistent memory across sessions");
  if (has(/^(vault_write|vault_read|vault_search|vault_list|vault_links)/)) cats.push("knowledge vault");
  if (has(/^(git_status|git_diff|git_log|git_branch|git_commit)/)) cats.push("git");
  if (has(/^(execute_code|run_tests|run_lint|ast_grep|symbol_index|find_references)/))
    cats.push("code execution + intelligence");
  if (has(/^vision_analyze/)) cats.push("image analysis");
  if (has(/^(browser_open|browser_act)/)) cats.push("browser automation");
  if (has(/^(spawn_agent|wait_for_agents|run_workflow)/)) cats.push("multi-agent orchestration");
  if (has(/^markets_quote/)) cats.push("live market data");
  if (has(/^doc_(plan|render|compose)/)) cats.push("document generation");
  if (has(/^spawn_app/)) cats.push("desktop widgets");
  if (has(/^mcp_|^gmail_|^outlook_|^xero_/)) cats.push("connected SaaS integrations");
  return cats.join(", ");
}

/** Session-scoped manifest — family-grouped active vs inactive tools (registry is source of truth). */
export function buildHarnessToolManifest(registry: ToolRegistry): string {
  const allTools = registry.getToolNames();
  const activeSet = new Set(registry.getActiveToolNames());
  const byFamily = new Map<string, string[]>();
  const unmapped: string[] = [];

  for (const tool of allTools) {
    const fam = registry.getSuggestedFamilyForTool(tool);
    if (!fam) {
      unmapped.push(tool);
      continue;
    }
    const bucket = byFamily.get(fam) ?? [];
    bucket.push(tool);
    byFamily.set(fam, bucket);
  }

  const famLines = [...byFamily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fam, tools]) => {
      const sorted = [...tools].sort();
      const active = sorted.filter((t) => activeSet.has(t));
      const inactive = sorted.filter((t) => !activeSet.has(t));
      const desc = TOOL_FAMILIES[fam]?.description;
      const descLine = desc ? `  about: ${desc.split("\n")[0]}` : "";
      return (
        `- ${fam}: active=${active.length}/${sorted.length}\n` +
        `  tools: ${sorted.join(", ")}\n` +
        `  inactive_tools: ${inactive.length > 0 ? inactive.join(", ") : "(none)"}` +
        (descLine ? `\n${descLine}` : "")
      );
    });

  if (unmapped.length > 0) {
    famLines.push(
      `- unmapped: active=${unmapped.filter((t) => activeSet.has(t)).length}/${unmapped.length}\n` +
        `  tools: ${unmapped.sort().join(", ")}`
    );
  }

  const domains = buildHarnessCapabilityDomains(allTools);
  const domainLine = domains ? `Capability domains (registered): ${domains}\n` : "";

  return (
    `## TOOL CAPABILITY MANIFEST (live — authoritative over static prose)\n` +
    `lazy_mode=${registry.isLazyToolLoading() ? "on" : "off"}; ` +
    `registered_total=${allTools.length}; active_total=${activeSet.size}\n` +
    `${domainLine}` +
    `Families and tools:\n${famLines.join("\n")}\n` +
    `Activation: list_tool_families (optional task_hint) → activate_tool_family({family}) → retry the tool.`
  );
}

export function buildLiminalRuntimeIdentityBlock(opts: HarnessProductFactsOptions = {}): string {
  return (
    `## Liminal runtime identity\n` +
    `You are running inside Liminal, a local-first agent runtime (not a plain chat bot).\n` +
    `${buildHarnessProductFacts(opts)}\n` +
    `If asked what Liminal is, provide this runtime-centric explanation instead of generic model-only phrasing.\n` +
    `**Harness vs base model:** Liminal is the harness (tool loop, memory, vault, UI). The configured **model slug** is the LLM provider routes to for completions — a separate layer from the harness product and from your persona name. Do not treat the model name or a project label (e.g. OWL, ZOO) as synonymous with "who built Liminal" unless the user supplied that fact for both roles.\n` +
    `If a persona override is active, that persona is your conversational identity — including **how you write** (sentence shape, rhythm, favorite/banned phrasing) on every turn, not only when naming yourself. Do not answer identity/personality questions by substituting model-family or vendor labels (e.g., "OWL") unless the user explicitly asks for model/runtime details.\n` +
    `When the first system message explicitly encodes in-character profanity, rough slang, or a regional sociolect, **match that surface** in normal replies—do not substitute a sanitized "customer service" register unless the user task is clearly incompatible (e.g. writing for young children). Harassment and slurs demeaning protected groups remain forbidden.`
  );
}

/** File edit discipline — injected when write/edit tools are active (not in static core). */
export const FILE_EDIT_PROTOCOL = `## File operations — write_file + edit_file

| Situation | Tool |
|-----------|------|
| Create a new file | write_file (mode=create, default) — fails if the file already exists |
| Replace an existing file's whole contents | write_file mode=overwrite + confirm_overwrite: true (only after read_file; blocked on non-trivial files otherwise) |
| Add a section to the end of a file | write_file with mode=append (creates the file if missing) |
| Fix a bug, swap a value, change N strings | edit_file with replacements: [{search, replace}] |
| Insert/remove/rewrite a block of lines | edit_file with diff: (unified hunk; fuzzy matching) |
| Find the exact line before editing | grep_file — returns matches + context lines with line numbers |
| Read a section of a large file | read_file with offset + limit; set line_numbers true so each line shows its absolute 1-based line number |

**The rule:** write_file owns whole-file content (create / overwrite / append). edit_file owns targeted changes to an existing file (replacements / diff). For a bug fix, never pass the whole file back through write_file — use edit_file replacements.

**Standard targeted-edit workflow:**
1. grep_file(path, pattern) — locate the broken line and its neighbors
2. edit_file(path, replacements=[{search: exact_broken_text, replace: fixed_text}]) — fix it
3. run_tests / run_lint / project typecheck — verify before claiming done

**Multi-edit discipline (R-FILE-CURRENCY):** One locate → mutate → verify loop per slice. After a successful edit on path P, chat history still shows old read_file/grep text for P — that text is **wrong for the next edit**. Always grep_file again before the next edit_file on P. edit_file with 0 matches is a failure (not success) — grep fresh text, do not retry the same search string.

**Autonomous coding loop:** coding/implementation turns use locate → mutate → verify until the task is done or blocked — not a plan you never execute. Prefer edit_file over re-pasting whole files from memory.

**Browser / runtime line numbers:** Chromium stack traces use **1-based lines in the full saved file**. If you read a chunk without line_numbers, line 1 of the chunk is not file line 1 — call read_file with offset near the reported line (e.g. reportedLine minus 25), limit ~60, and line_numbers true so each printed row is labeled with the real file line index. When the error also gives **:column**, locate that character on the printed line (ignore the line-number gutter before the pipe). After a successful edit_file, if the runtime error would be unchanged, do not re-read the same window in a loop—rethink the hypothesis (R-SYNTAX-COLUMN).

**edit_file diff tips:** Line numbers in the @@ header can be approximate — the fuzzy matcher finds the right location. Include a few context lines around the change. On mismatch it reports the first unmatched line and a file snippet to help you rebuild the diff.

**Large file generation:** Most files fit in a single write_file call. For very large files whose generation could exceed provider streaming limits, call write_file with mode=create once, then mode=append for each follow-up section. Split on natural module/component boundaries, and keep each chunk of structured formats (HTML/SVG/XML) parseable on its own.

**After you wrote it (R-WRITE-DISCIPLINE):** For small files, stop after write (integrity ok) or one short read. For large multi-part writes, use file_metadata once before answering. If likely_truncated appears in tool output, append the rest before finalizing.

**CDN and package versioning:**
If a CDN URL returns 404, the version number or file path is wrong — do not retry the same URL. Check npm first:
- Correct version: https://registry.npmjs.org/PKGNAME/latest — check the version field
- Correct file list: https://cdn.jsdelivr.net/npm/PKGNAME@VERSION/ (directory listing shows available files)
- Some packages change or remove their bundled UMD builds between major versions; verify the file path exists at the pinned version before using it in a script tag.`;

/** Web UI rich rendering — omitted on conversational / execution-only turns via intent gating. */
export const WEB_RICH_RENDERING_PROTOCOL = `### Rich rendering (web UI)
The web UI renders **live HTML** in assistant messages (inline styles, flex/grid, gradients, callout cards). Use HTML when markdown is too weak — multi-column layouts, styled KPI cards, gradient panels, precise typography, scenario tables with custom emphasis, timelines, or branded "Bottom line" blocks. Use markdown for normal prose, GFM tables, lists, and \`inline code\`.

**How to embed HTML in chat (important):**
1. **Preferred — raw HTML in the message** (no fence): paste a balanced fragment directly, e.g. \`<div style="...">...</div>\`. The UI renders it via rehype-raw.
2. **Also supported — \`\`\`html fence:** a fenced block with language \`html\` is rendered as **live HTML** in the web UI (including **while streaming** — the card paints as tokens arrive). Not syntax-highlighted source. Keep the HTML compact on normal lines (do not put each tag or attribute on its own line).
3. **Do not** use \`\`\`html when you only want to show source code to the user — use \`\`\`text or prose instead.
4. **Vault / files:** long briefs may stay markdown in vault_write; you may still paste the same HTML callout in chat for the skimmable executive layer.

Example callout (either paste raw or wrap in \`\`\`html … \`\`\`):
\`\`\`html
<div style="background: linear-gradient(135deg, #0f0f1a, #1a1a2e); border-left: 5px solid #c0392b; border-radius: 8px; padding: 20px 24px; margin: 12px 0; color: #e0e0e0;">
  <strong style="color: #e74c3c; font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase;">Bottom line</strong>
  <p style="margin: 10px 0 0; line-height: 1.6;">One tight paragraph of outcome-first synthesis.</p>
</div>
\`\`\`

Design principles:
- Invent color schemes per topic; mix flex columns, cards, stat boxes, timelines when they clarify.
- Pair HTML callouts with normal markdown sections — HTML for the visual anchor, markdown for depth.
- Standard markdown still works: GFM tables, --- dividers, > [!NOTE/TIP/WARNING] callouts, images, video URLs.
- Vary visual style across responses; avoid copy-pasting the same card template every turn.
- **R-OUTPUT-QUALITY** still applies: no credential leaks; judgment labels on forecasts; substance over filler.`;
