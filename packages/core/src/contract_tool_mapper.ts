/**
 * Contract-to-tool-family mapper.
 *
 * At sub-agent spawn time, derives the minimum required tool families from the
 * spawn contract objective + role using BM25 keyword matching against family
 * descriptions. Pre-activates those families before the first child send(),
 * eliminating the "missing tool" round trip.
 *
 * Falls back to the baseline profile if no match exceeds the threshold.
 */

import { tokenize } from "./memory_rank.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface ToolFamilyDescriptor {
  family: string;
  description: string;
  keywords: string[];
}

// Canonical family → description + keyword signals
export const TOOL_FAMILY_DESCRIPTORS: ToolFamilyDescriptor[] = [
  {
    family: "files_edit",
    description: "Read, write, edit, patch, search-replace files; directory listing; repo map",
    keywords: ["file", "write", "edit", "read", "code", "patch", "create", "modify", "source", "directory", "repo", "search replace"],
  },
  {
    family: "shell",
    description: "Run shell commands, background processes, process management, terminal execution, serve/build/test runs",
    keywords: ["shell", "command", "run", "execute", "terminal", "process", "bash", "script", "install", "build", "npm", "pip", "serve", "start", "dev", "compile", "bundle", "deploy", "launch"],
  },
  {
    family: "git",
    description: "Git status, diff, log, branch, commit, checkpoint, rollback",
    keywords: ["git", "commit", "branch", "diff", "log", "version control", "merge", "stash", "checkpoint"],
  },
  {
    family: "web",
    description: "Web fetch, web search, HTTP requests, research from URLs, internet",
    keywords: ["web", "fetch", "search", "url", "http", "internet", "research", "download", "api", "scrape", "browse"],
  },
  {
    family: "memory_advanced",
    description: "Advanced memory recall, knowledge vault, memory graph, consolidation",
    keywords: ["memory", "recall", "knowledge", "vault", "obsidian", "notes", "history", "past", "remember"],
  },
  {
    family: "code_intel",
    description: "AST grep, symbol index, find references, run tests, run lint, execute code, verify/validate",
    keywords: ["symbol", "ast", "reference", "test", "tests", "lint", "typecheck", "type error", "analysis", "refactor", "grep", "verify", "validate", "imports", "unused", "audit"],
  },
  {
    family: "tasks",
    description: "Task persistence, feature checklist, task scheduling, session agenda",
    keywords: ["task", "checklist", "schedule", "milestone", "agenda", "plan", "checkpoint", "feature"],
  },
  {
    family: "vision",
    description: "Analyze images, screenshots, diagrams using vision model",
    keywords: ["image", "screenshot", "photo", "diagram", "vision", "picture", "visual", "ocr"],
  },
  {
    family: "browser",
    description: "Headless browser automation, Playwright, web UI interaction, serve a file, screenshot a page",
    keywords: ["browser", "playwright", "automate", "click", "form", "navigate", "e2e", "ui test", "serve", "screenshot", "render", "preview", "open the page", "interact"],
  },
  {
    family: "navigation",
    description: "Repository tree orientation, find files by glob, file metadata, chunked reads, resolve imports",
    keywords: ["map", "tree", "structure", "find files", "glob", "locate", "metadata", "overview", "explore", "enumerate", "inventory", "every file", "all files"],
  },
  {
    family: "markets",
    description: "Financial market data, stock quotes, FX, commodities, crypto",
    keywords: ["stock", "market", "quote", "price", "equity", "crypto", "forex", "financial", "trading"],
  },
  {
    family: "document",
    description: "Generate PPTX, DOCX, PDF documents using the document engine pipeline",
    keywords: ["slide", "presentation", "pptx", "docx", "pdf", "document", "report", "deck", "word"],
  },
  {
    family: "meta",
    description: "Suggest harness improvements, view insights, self-reflection tools",
    keywords: ["improve", "insight", "reflect", "suggest", "optimize", "self-improve", "harness"],
  },
  {
    family: "reasoning",
    description: "Breakdown decompose reason plan structured thinking",
    keywords: ["breakdown", "decompose", "reason", "plan", "think step", "infer"],
  },
  {
    family: "context",
    description: "Context window check compress token limit",
    keywords: ["context", "compress", "token", "window", "too long"],
  },
  {
    family: "google_mail",
    description: "Google Gmail send draft inbox",
    keywords: ["gmail", "google mail", "inbox", "send email"],
  },
  {
    family: "google_calendar",
    description: "Google Calendar events meetings schedule",
    keywords: ["google calendar", "meeting", "schedule", "freebusy"],
  },
  {
    family: "google_office",
    description: "Google Docs Sheets Slides spreadsheets documents",
    keywords: ["docs", "sheets", "slides", "spreadsheet", "gdoc"],
  },
  {
    family: "google_workspace",
    description: "Google Gmail calendar drive docs sheets slides workspace",
    keywords: ["google", "workspace", "drive", "calendar", "gmail"],
  },
  {
    family: "microsoft_mail",
    description: "Microsoft Outlook mail send draft",
    keywords: ["outlook", "microsoft mail", "send email"],
  },
  {
    family: "microsoft_calendar",
    description: "Microsoft Outlook calendar meetings",
    keywords: ["outlook calendar", "meeting", "schedule"],
  },
  {
    family: "microsoft_files",
    description: "OneDrive SharePoint Excel files",
    keywords: ["onedrive", "sharepoint", "excel", "files"],
  },
  {
    family: "microsoft_collab",
    description: "Teams Planner To Do OneNote",
    keywords: ["teams", "planner", "todo", "onenote"],
  },
  {
    family: "microsoft_365",
    description: "Microsoft Outlook OneDrive Teams Office 365 mail calendar",
    keywords: ["outlook", "microsoft", "onedrive", "teams", "office 365", "m365", "sharepoint"],
  },
  {
    family: "azure",
    description: "Azure cloud ARM subscriptions resource groups VMs storage Key Vault",
    keywords: ["azure", "resource group", "subscription", "key vault", "app service", "cosmos", "aks", "blob"],
  },
  {
    family: "slack",
    description: "Slack channels messages team chat",
    keywords: ["slack", "channel", "dm", "workspace chat"],
  },
  {
    family: "notion",
    description: "Notion pages databases wiki docs",
    keywords: ["notion", "wiki", "database", "workspace docs"],
  },
  {
    family: "linear",
    description: "Linear issues backlog sprint tracking",
    keywords: ["linear", "issue", "backlog", "sprint"],
  },
  {
    family: "ida",
    description: "IDA Pro reverse engineering decompile disassembly xrefs",
    keywords: [
      "ida",
      "reverse engineering",
      "disassembly",
      "decompile",
      "binary",
      "crackme",
      "malware",
      "xrefs",
      "patch",
      "crack",
      "dll",
      "exe",
      "pe",
      "export",
      "steam",
    ],
  },
  {
    family: "github",
    description: "GitHub repos issues pull requests code review",
    keywords: ["github", "pull request", "merge request", "issue", "repository"],
  },
  {
    family: "xero",
    description: "Xero accounting invoices contacts",
    keywords: ["xero", "invoice", "accounting", "bookkeeping"],
  },
];

function bm25Score(queryTerms: string[], doc: string[]): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgdl = 20; // approximate for short keyword lists
  const dl = doc.length;
  const tf = new Map<string, number>();
  for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const q of queryTerms) {
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const idf = Math.log(1 + (TOOL_FAMILY_DESCRIPTORS.length - 1 + 0.5) / (1 + 0.5));
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * dl) / avgdl));
  }
  return score;
}

function resolveThreshold(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_CONTRACT_MAP_THRESHOLD")?.trim();
  const n = raw ? Number(raw) : 0.25;
  return Number.isFinite(n) ? Math.max(0.05, Math.min(1, n)) : 0.25;
}

export interface ContractFamilyMapping {
  families: string[];
  scores: Record<string, number>;
  source: "contract" | "default";
}

/** Inputs available on every forkChild spawn — used to infer tool families without a spawnContract. */
export interface SpawnFamilyInferenceInput {
  goal: string;
  taskBrief?: string;
  userPrompt?: string;
  systemPrompt?: string;
  spawnContract?: { objective: string; role: string };
}

/**
 * Derive tool families to pre-activate for a sub-agent from whatever prompt text
 * the spawner provided (contract, user_prompt, task brief, or goal label).
 */
export function inferSpawnToolFamiliesFromChildConfig(
  cfg: SpawnFamilyInferenceInput,
  opts?: { maxFamilies?: number; threshold?: number }
): ContractFamilyMapping {
  const objective =
    cfg.spawnContract?.objective.trim() ||
    cfg.userPrompt?.trim() ||
    cfg.taskBrief?.trim() ||
    cfg.goal.trim() ||
    "";
  const role =
    cfg.spawnContract?.role.trim() ||
    cfg.systemPrompt?.trim().slice(0, 500) ||
    "";
  return mapContractToToolFamilies(objective, role, opts);
}

/**
 * Given a spawn contract objective and role, return the best-matching tool families
 * to pre-activate. Returns at most maxFamilies families above the threshold.
 */
export function mapContractToToolFamilies(
  objective: string,
  role: string,
  opts?: { maxFamilies?: number; threshold?: number }
): ContractFamilyMapping {
  const maxFamilies = opts?.maxFamilies ?? 4;
  const threshold = opts?.threshold ?? resolveThreshold();

  const combined = `${role} ${objective}`.slice(0, 2000);
  const queryTerms = tokenize(combined);

  if (queryTerms.length === 0) {
    return { families: ["files_edit", "shell"], scores: {}, source: "default" };
  }

  const scores: Record<string, number> = {};
  let maxScore = 0;

  for (const desc of TOOL_FAMILY_DESCRIPTORS) {
    const docTokens = tokenize(`${desc.description} ${desc.keywords.join(" ")}`);
    const score = bm25Score(queryTerms, docTokens);
    scores[desc.family] = score;
    if (score > maxScore) maxScore = score;
  }

  // Normalize
  if (maxScore > 0) {
    for (const fam of Object.keys(scores)) {
      scores[fam] = (scores[fam] ?? 0) / maxScore;
    }
  }

  const families = Object.entries(scores)
    .filter(([, s]) => s >= threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxFamilies)
    .map(([fam]) => fam);

  // Always include files_edit as a baseline (nearly all tasks need file access)
  if (!families.includes("files_edit")) families.push("files_edit");

  // File-deliverable objectives (save/write report to path) need the full write surface.
  if (
    /\b(save|write|create|output|deliver|produce|draft|persist)\b[\s\S]{0,48}\b(file|files|document|markdown|\.md|report)\b/i.test(
      objective
    ) &&
    !families.includes("files_edit")
  ) {
    families.push("files_edit");
  }

  return {
    families,
    scores,
    source: families.length > 0 ? "contract" : "default",
  };
}
