/**
 * MCP server catalog — static knowledge of well-known MCP servers.
 *
 * Used by mcp_suggest to match a capability description to concrete servers,
 * classify them as ready-to-connect vs. needs-credentials, and produce
 * copy-paste mcp_connect calls.
 *
 * Signal gathering (environment detection) lives here so mcp_suggest can
 * call it independently without going through world_context.ts.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";

// ── Catalog types ─────────────────────────────────────────────────────────────

export interface McpCredentialVar {
  name: string;
  description: string;
  /** Alternative env var names that also satisfy this requirement. */
  alternatives?: string[];
  /** If true, absence doesn't block connection — but the tool should mention it. */
  optional?: boolean;
}

export interface McpCatalogEntry {
  /** Short identifier used in mcp_connect name param (also used as key). */
  id: string;
  displayName: string;
  npmPackage: string;
  /** Command to run (almost always "npx"). */
  command: string;
  /** Args to npx/command. Use "<PLACEHOLDER>" for user-supplied values (path, URL, conn string). */
  args: string[];
  /** Human note about any placeholder args the user must fill in. */
  argsNote?: string;
  description: string;
  /** Keyword tags used for search matching — include synonyms, task verbs, domain terms. */
  categories: string[];
  /** Env vars required for authentication. Empty = no credentials needed. */
  requiredEnvVars: McpCredentialVar[];
  /** World context signal strings (from gatherMcpEnvironment) that boost this entry's rank. */
  detectionSignals: string[];
  /** Short example showing exactly how to call mcp_connect for this server. */
  connectExample: string;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "filesystem",
    displayName: "Filesystem",
    npmPackage: "@modelcontextprotocol/server-filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "<absolute-path>"],
    argsNote: "Replace <absolute-path> with the directory to expose (e.g. /tmp or C:/Users/you/docs).",
    description: "Expose an arbitrary directory tree for reading, writing, listing, and searching — useful for paths outside the workspace root.",
    categories: [
      "files", "filesystem", "directory", "folder", "documents", "media",
      "path", "arbitrary path", "outside workspace", "external files",
    ],
    requiredEnvVars: [],
    detectionSignals: ["npx_available"],
    connectExample: `mcp_connect({ name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/expose"] })`,
  },
  {
    id: "github",
    displayName: "GitHub",
    npmPackage: "@modelcontextprotocol/server-github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "Full GitHub API access — PRs, issues, repositories, code review comments, Actions workflows, releases, commits, and branch management.",
    categories: [
      "github", "pull request", "pr", "issue", "repository", "repo", "code review",
      "actions", "workflow", "ci", "release", "commit", "branch", "merge", "fork",
      "gist", "stargazer", "contributor",
    ],
    requiredEnvVars: [
      {
        name: "GITHUB_PERSONAL_ACCESS_TOKEN",
        description: "GitHub personal access token (classic or fine-grained) with repo + workflow scopes.",
        alternatives: ["GITHUB_TOKEN"],
      },
    ],
    detectionSignals: ["git_remote_github"],
    connectExample: `mcp_connect({ name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] })`,
  },
  {
    id: "gitlab",
    displayName: "GitLab",
    npmPackage: "@modelcontextprotocol/server-gitlab",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    description: "GitLab API access — merge requests, issues, pipelines, repositories, CI/CD, and project management.",
    categories: [
      "gitlab", "merge request", "mr", "issue", "pipeline", "ci", "cd", "repository",
      "project", "milestone", "epic", "group",
    ],
    requiredEnvVars: [
      {
        name: "GITLAB_PERSONAL_ACCESS_TOKEN",
        description: "GitLab personal access token with api scope.",
        alternatives: ["GITLAB_TOKEN"],
      },
    ],
    detectionSignals: ["git_remote_gitlab"],
    connectExample: `mcp_connect({ name: "gitlab", command: "npx", args: ["-y", "@modelcontextprotocol/server-gitlab"] })`,
  },
  {
    id: "sqlite",
    displayName: "SQLite",
    npmPackage: "@modelcontextprotocol/server-sqlite",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "<path-to-db-file>"],
    argsNote: "Replace <path-to-db-file> with the absolute path to your .db or .sqlite file.",
    description: "Query and inspect a local SQLite database — list tables, run SELECT queries, inspect schema, and read data.",
    categories: [
      "sqlite", "database", "db", "sql", "query", "table", "schema", "data",
      "local database", "embedded database", "records", "rows",
    ],
    requiredEnvVars: [],
    detectionSignals: ["local_sqlite_file"],
    connectExample: `mcp_connect({ name: "sqlite", command: "npx", args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/path/to/database.sqlite"] })`,
  },
  {
    id: "postgres",
    displayName: "PostgreSQL",
    npmPackage: "@modelcontextprotocol/server-postgres",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "<connection-string>"],
    argsNote: "Pass your connection string directly as the last arg, e.g. postgresql://user:pass@localhost:5432/mydb. Alternatively set POSTGRES_URL and reference it.",
    description: "Query a PostgreSQL database — list schemas, run SQL, inspect tables, and read/write data.",
    categories: [
      "postgres", "postgresql", "database", "db", "sql", "query", "table", "schema",
      "data", "relational", "records", "rows", "pg",
    ],
    requiredEnvVars: [
      {
        name: "POSTGRES_URL",
        description: "PostgreSQL connection string: postgresql://user:pass@host:5432/dbname",
        alternatives: ["DATABASE_URL", "POSTGRES_CONNECTION_STRING"],
      },
    ],
    detectionSignals: ["env_postgres_url", "port_5432"],
    connectExample: `mcp_connect({ name: "postgres", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", process.env.POSTGRES_URL] })`,
  },
  {
    id: "puppeteer",
    displayName: "Puppeteer Browser",
    npmPackage: "@modelcontextprotocol/server-puppeteer",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    description: "Headless Chromium browser — navigate pages, take screenshots, fill forms, click elements, extract content, and automate web interactions.",
    categories: [
      "browser", "puppeteer", "screenshot", "web automation", "scraping", "crawling",
      "rendering", "headless", "navigate", "click", "form", "page", "html", "dom",
      "pdf", "extract", "web testing",
    ],
    requiredEnvVars: [],
    detectionSignals: ["npx_available"],
    connectExample: `mcp_connect({ name: "puppeteer", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] })`,
  },
  {
    id: "brave-search",
    displayName: "Brave Search",
    npmPackage: "@modelcontextprotocol/server-brave-search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    description: "Privacy-respecting web search via Brave Search API — an alternative to web_search with different index coverage.",
    categories: [
      "search", "web search", "brave", "research", "internet", "find", "lookup",
      "alternative search",
    ],
    requiredEnvVars: [
      {
        name: "BRAVE_API_KEY",
        description: "Brave Search API key — get free at https://api.search.brave.com/register",
      },
    ],
    detectionSignals: ["env_brave_key"],
    connectExample: `mcp_connect({ name: "brave-search", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"] })`,
  },
  {
    id: "slack",
    displayName: "Slack",
    npmPackage: "@modelcontextprotocol/server-slack",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    description: "Read and send Slack messages — list channels, read conversation history, post messages, and search for content across workspaces.",
    categories: [
      "slack", "message", "channel", "team", "communication", "notification",
      "workspace", "dm", "thread", "post", "chat",
    ],
    requiredEnvVars: [
      {
        name: "SLACK_BOT_TOKEN",
        description: "Slack Bot OAuth token (xoxb-...) from your Slack app settings.",
      },
      {
        name: "SLACK_TEAM_ID",
        description: "Slack workspace/team ID (found in workspace settings).",
        optional: true,
      },
    ],
    detectionSignals: ["env_slack_token"],
    connectExample: `mcp_connect({ name: "slack", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"] })`,
  },
  {
    id: "google-drive",
    displayName: "Google Drive",
    npmPackage: "@modelcontextprotocol/server-gdrive",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    description: "Browse, read, and search Google Drive — access Docs, Sheets, Slides, and uploaded files.",
    categories: [
      "google drive", "gdrive", "google docs", "google sheets", "spreadsheet",
      "document", "drive", "cloud storage", "google",
    ],
    requiredEnvVars: [
      {
        name: "GOOGLE_APPLICATION_CREDENTIALS",
        description: "Path to a Google service account JSON file with Drive API access.",
        alternatives: ["GDRIVE_CLIENT_ID"],
      },
    ],
    detectionSignals: ["env_google_creds"],
    connectExample: `mcp_connect({ name: "google-drive", command: "npx", args: ["-y", "@modelcontextprotocol/server-gdrive"] })`,
  },
  {
    id: "notion",
    displayName: "Notion",
    npmPackage: "@notionhq/notion-mcp-server",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    description: "Read and write Notion pages and databases — query database entries, read page content, create and update pages.",
    categories: [
      "notion", "knowledge base", "wiki", "page", "database", "document",
      "note taking", "project management", "kanban", "table",
    ],
    requiredEnvVars: [
      {
        name: "NOTION_API_KEY",
        description: "Notion integration token from https://www.notion.so/my-integrations",
        alternatives: ["NOTION_TOKEN"],
      },
    ],
    detectionSignals: ["env_notion_key"],
    connectExample: `mcp_connect({ name: "notion", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] })`,
  },
  {
    id: "linear",
    displayName: "Linear",
    npmPackage: "@linear/mcp-server",
    command: "npx",
    args: ["-y", "@linear/mcp-server"],
    description: "Query and update Linear — list issues, read tickets, create issues, update status, and inspect project roadmaps.",
    categories: [
      "linear", "issue", "ticket", "project management", "roadmap", "sprint",
      "backlog", "milestone", "team", "triage",
    ],
    requiredEnvVars: [
      {
        name: "LINEAR_API_KEY",
        description: "Linear personal API key from https://linear.app/settings/api",
      },
    ],
    detectionSignals: ["env_linear_key"],
    connectExample: `mcp_connect({ name: "linear", command: "npx", args: ["-y", "@linear/mcp-server"] })`,
  },
  {
    id: "fetch",
    displayName: "HTTP Fetch",
    npmPackage: "@modelcontextprotocol/server-fetch",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    description: "Fetch any URL with full control over headers, method, and body — useful when web_fetch restrictions or CORS prevent direct access.",
    categories: [
      "http", "fetch", "url", "api", "rest", "curl", "request", "header",
      "post", "put", "delete", "raw http", "custom headers", "authentication header",
    ],
    requiredEnvVars: [],
    detectionSignals: ["npx_available"],
    connectExample: `mcp_connect({ name: "fetch", command: "npx", args: ["-y", "@modelcontextprotocol/server-fetch"] })`,
  },
];

// ── Environment signal gathering ──────────────────────────────────────────────

/** Env vars that imply a credential is available for a specific service. */
const CREDENTIAL_ENV_SIGNALS: Record<string, string> = {
  GITHUB_PERSONAL_ACCESS_TOKEN: "env_github_pat",
  GITHUB_TOKEN: "env_github_token",
  GITLAB_PERSONAL_ACCESS_TOKEN: "env_gitlab_pat",
  GITLAB_TOKEN: "env_gitlab_token",
  SLACK_BOT_TOKEN: "env_slack_token",
  SLACK_TEAM_ID: "env_slack_team",
  NOTION_API_KEY: "env_notion_key",
  NOTION_TOKEN: "env_notion_token",
  LINEAR_API_KEY: "env_linear_key",
  BRAVE_API_KEY: "env_brave_key",
  POSTGRES_URL: "env_postgres_url",
  DATABASE_URL: "env_database_url",
  POSTGRES_CONNECTION_STRING: "env_postgres_url",
  GOOGLE_APPLICATION_CREDENTIALS: "env_google_creds",
  GDRIVE_CLIENT_ID: "env_google_creds",
  MONGODB_URI: "env_mongo_url",
  REDIS_URL: "env_redis_url",
};

export interface McpEnvironmentSignals {
  /** Active signal identifiers from env vars, git remote, local files. */
  signals: Set<string>;
  /** Human-readable env var names that were detected. */
  detectedEnvVars: string[];
  /** Git remote host (e.g. "github.com") or null. */
  gitRemoteHost: string | null;
  /** Local SQLite/db files found in workspace root. */
  localDbFiles: string[];
}

/**
 * Fast environment scan — no shell calls, no port probes.
 * Safe to call from mcp_suggest handler without significant latency.
 */
export async function gatherMcpEnvironmentSignals(): Promise<McpEnvironmentSignals> {
  const signals = new Set<string>();
  const detectedEnvVars: string[] = [];

  // env var credentials
  for (const [varName, signal] of Object.entries(CREDENTIAL_ENV_SIGNALS)) {
    if (process.env[varName]) {
      signals.add(signal);
      if (!detectedEnvVars.includes(varName)) detectedEnvVars.push(varName);
    }
  }

  // npx (almost always available)
  signals.add("npx_available");

  // git remote host — read .git/config directly (no shell, fast)
  let gitRemoteHost: string | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const ws = resolveWorkspaceRoot();
    const gitConfig = await readFile(join(ws, ".git", "config"), "utf-8").catch(() => "");
    const m = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
    if (m) {
      const url = m[1]!.trim();
      if (url.includes("github.com")) { gitRemoteHost = "github.com"; signals.add("git_remote_github"); }
      else if (url.includes("gitlab.com")) { gitRemoteHost = "gitlab.com"; signals.add("git_remote_gitlab"); }
      else if (url.includes("bitbucket.org")) { gitRemoteHost = "bitbucket.org"; signals.add("git_remote_bitbucket"); }
    }
  } catch { /* ignore */ }

  // local db files
  let localDbFiles: string[] = [];
  try {
    const ws = resolveWorkspaceRoot();
    if (existsSync(ws)) {
      const files = await readdir(ws);
      localDbFiles = files.filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f));
      if (localDbFiles.length > 0) signals.add("local_sqlite_file");
    }
  } catch { /* ignore */ }

  return { signals, detectedEnvVars, gitRemoteHost, localDbFiles };
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface CatalogSearchResult {
  entry: McpCatalogEntry;
  /** Score: keyword match count + signal bonus. */
  score: number;
  /** Whether all required (non-optional) credentials are available. */
  ready: boolean;
  /** Missing required env vars. */
  missing: McpCredentialVar[];
}

/** Simple tokeniser — lowercased words. */
function tokenise(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Search the catalog for entries matching a capability description.
 * Returns results sorted by score (ready entries first within same score bracket).
 */
export function searchCatalog(
  query: string,
  env: McpEnvironmentSignals,
  connectedIds: Set<string> = new Set()
): CatalogSearchResult[] {
  const queryTokens = tokenise(query);
  const results: CatalogSearchResult[] = [];

  for (const entry of MCP_CATALOG) {
    if (connectedIds.has(entry.id)) continue; // skip already-connected

    // Keyword score: count query tokens found in categories + displayName + description
    const corpus = tokenise(
      [entry.displayName, entry.description, ...entry.categories].join(" ")
    );
    const corpusSet = new Set(corpus);
    let score = 0;
    for (const tok of queryTokens) {
      if (corpusSet.has(tok)) score += 1;
    }
    if (score === 0) continue; // no match at all

    // Signal bonus: +2 per matching detection signal
    for (const sig of entry.detectionSignals) {
      if (env.signals.has(sig)) score += 2;
    }

    // Credential check
    const missing: McpCredentialVar[] = [];
    for (const req of entry.requiredEnvVars) {
      if (req.optional) continue;
      const names = [req.name, ...(req.alternatives ?? [])];
      const present = names.some((n) => !!process.env[n]);
      if (!present) missing.push(req);
    }
    const ready = missing.length === 0;

    results.push({ entry, score, ready, missing });
  }

  // Sort: higher score first; within same score, ready before not-ready
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.ready ? 0 : 1) - (b.ready ? 0 : 1);
  });

  return results;
}

// ── World-context summary (raw signals, no catalog knowledge) ─────────────────

/**
 * Produce the compact "MCP environment" string injected into world context.
 * Returns null if there is nothing interesting to surface.
 * (No catalog import — this is pure env detection for world_context.ts to use.)
 */
export async function formatMcpEnvironmentSummary(): Promise<string | null> {
  const env = await gatherMcpEnvironmentSignals();
  const parts: string[] = [];

  if (env.gitRemoteHost) parts.push(`Git remote: ${env.gitRemoteHost}`);
  if (env.detectedEnvVars.length > 0) {
    parts.push(`Credentials in env: ${env.detectedEnvVars.join(", ")}`);
  }
  if (env.localDbFiles.length > 0) {
    parts.push(`Local databases: ${env.localDbFiles.join(", ")}`);
  }

  if (parts.length === 0) return null;

  return (
    parts.join("\n") +
    "\n→ mcp_suggest(\"<capability>\") to find and connect the right MCP server."
  );
}
