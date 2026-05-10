/**
 * World context — dynamic environmental grounding injected at session start.
 *
 * Runs 8 gatherers in parallel with individual timeouts. Any failure degrades
 * gracefully to "unknown" — never blocks session start.
 *
 * Sections gathered:
 *  1. System    — OS, shell, CWD, user, Node.js version        (sync)
 *  2. Resources — RAM, CPU, disk free                          (async)
 *  3. Project   — package.json, package manager, frameworks    (async)
 *  4. Git       — branch, commit, dirty status, remote URL     (async)
 *  5. Tools     — installed CLIs + versions                    (async, parallel probes)
 *  6. Ports     — which dev ports are already in use           (async)
 *  7. Env       — which "interesting" env vars are SET/unset   (sync)
 *  8. Style     — indent, quotes, line endings from config     (async)
 *  9. Memory    — prefetch fact/experience entries from notes  (async)
 */
import os from "node:os";
import path from "node:path";
import { readFile, access, readdir } from "node:fs/promises";
import { getAgentVaultRoot, getExplicitAgentVaultPathFromEnv } from "./vault_path.js";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";
import { cosineSimilarity, fetchEmbeddings } from "./embeddings.js";
import { gatherRepoMapLines } from "./repo_map.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { formatFailureDigestForWorldContext } from "./failure_digest.js";
import { formatGoldenEvalHints } from "./golden_eval.js";
import { formatRecipeLibraryHints } from "./recipe_library.js";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ─── Public type (mirrored in types.ts as re-export) ─────────────────────────

export interface WorldContextOptions {
  /** e.g. "Brisbane, Australia" — shown alongside timezone */
  location?: string;
  /**
   * Long-horizon harness mode (also read from AGENT_SESSION_MODE if unset).
   * initializer — first session: scaffold features, progress file, init script.
   * coding — later sessions: incremental work, read handoff artifacts first.
   */
  sessionMode?: "initializer" | "coding";
  /** Extra freeform text appended to the context block */
  notes?: string;
  /** Set true to skip injection entirely. Child agents always skip. */
  disabled?: boolean;
  /**
   * Absolute project / monorepo root for CWD line, git, notes paths, and repo map.
   * Defaults to `AGENT_WORKSPACE_ROOT` or `process.cwd()`.
   */
  workspaceRoot?: string;
  /**
   * First user message of the session — used to surface BM25-ranked notes + vault
   * snippets under "Relevant memory" (root harness only).
   */
  firstUserMessage?: string;
}

// ─── Internal result types ────────────────────────────────────────────────────

interface ResourceInfo {
  freeRamGB: number;
  totalRamGB: number;
  cpuCount: number;
  cpuModel: string;
  diskFreeGB: number | null;
  diskTotalGB: number | null;
}

interface ProjectInfo {
  name: string;
  isMonorepo: boolean;
  packageManager: string;
  scripts: string[];
  frameworks: string[];
  workspaceCount?: number;
  moduleType: "esm" | "cjs" | "unknown";
}

interface GitInfo {
  branch: string;
  commitHash: string;
  commitMessage: string;
  commitAge: string;
  remoteUrl: string | null;
  isDirty: boolean;
  stashCount: number;
}

interface ToolVersions {
  found: Array<{ name: string; version: string }>;
  notFound: string[];
}

interface PortInfo {
  busy: number[];
  free: number[];
}

interface EnvInventory {
  set: string[];
  unset: string[];
}

interface CodeStyle {
  indentStyle: "space" | "tab" | null;
  indentSize: number | null;
  quotes: "single" | "double" | null;
  semi: boolean | null;
  lineEndings: "lf" | "crlf" | "cr" | null;
  printWidth: number | null;
  source: string;
}

interface SessionMemory {
  facts: Array<{ key: string; value: string }>;
  experiences: Array<{ key: string; value: string }>;
  entities: Array<{ key: string; value: string }>;
  reflections: Array<{ value: string }>;
  recipes: Array<{ value: string }>;
  totalCount: number;
  countByType: Record<string, number>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Resolves to null instead of rejecting when deadline (ms) is exceeded. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Run a command and return stdout, or null on any error/timeout. */
async function exec(
  cmd: string,
  args: string[],
  timeoutMs = 500,
  cwd?: string
): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFile(cmd, args, {
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
    });
    return (stdout || stderr).trim() || null;
  } catch {
    return null;
  }
}

/** Find a file by searching upward from `startDir` (up to `maxLevels` directories). */
async function findUpward(filename: string, startDir: string, maxLevels = 5): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (let i = 0; i < maxLevels; i++) {
    const candidate = path.join(dir, filename);
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** Read a file and return its text, or null on failure. */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

// ─── 1. System context (synchronous) ─────────────────────────────────────────

function getShell(): string {
  if (process.platform === "win32") {
    if (process.env["PSModulePath"]) {
      const isCore = process.env["PSModulePath"]?.toLowerCase().includes("powershell\\7") ||
                     process.env["PSModulePath"]?.toLowerCase().includes("powershell/7");
      return isCore ? "PowerShell 7 (pwsh.exe)" : "Windows PowerShell (powershell.exe)";
    }
    return "cmd.exe";
  }
  const shellPath = process.env["SHELL"] ?? "/bin/sh";
  return shellPath.split("/").at(-1) ?? shellPath;
}

function getOSLabel(): string {
  const arch = process.arch;
  if (process.platform === "win32") {
    const release = os.release();
    const build = parseInt(release.match(/^10\.0\.(\d+)/)?.[1] ?? "0", 10);
    const win = build >= 22000 ? "Windows 11" : build >= 10000 ? "Windows 10" : "Windows";
    return `${win} build ${build} (${arch})`;
  }
  if (process.platform === "darwin") return `macOS ${os.release()} (${arch})`;
  return `Linux ${os.release()} (${arch})`;
}

function getUtcOffset(): string {
  const off = -new Date().getTimezoneOffset();
  const s = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `UTC${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

function getTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return getUtcOffset(); }
}

function getUsername(): string {
  try { return os.userInfo().username; }
  catch { return process.env["USERNAME"] ?? process.env["USER"] ?? "unknown"; }
}

function getShellNote(shell: string): string {
  if (process.platform === "win32") {
    if (shell.toLowerCase().includes("powershell"))
      return "Get-ChildItem (ls), Get-Content (cat), Remove-Item (rm), Copy-Item (cp). Paths: \\ or /.";
    return "dir (not ls), type (not cat), del (not rm). Paths: \\.";
  }
  if (process.platform === "darwin") return `${shell}. BSD utils — use gsed for GNU sed. Paths: /.`;
  return `${shell}. Paths: /.`;
}

// ─── 2. System resources ──────────────────────────────────────────────────���──

async function gatherResources(workspaceRoot: string): Promise<ResourceInfo> {
  const cpus = os.cpus();
  const base: ResourceInfo = {
    freeRamGB: os.freemem() / 1024 ** 3,
    totalRamGB: os.totalmem() / 1024 ** 3,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown",
    diskFreeGB: null,
    diskTotalGB: null,
  };

  // Disk via fs.statfs (Node.js 19.6+)
  try {
    // Dynamic property access to avoid TypeScript error on older @types/node
    const { statfs } = await import("node:fs/promises") as typeof import("node:fs/promises") & {
      statfs?: (path: string) => Promise<{ bsize: number; bavail: number; blocks: number }>;
    };
    if (statfs) {
      const stats = await statfs(workspaceRoot);
      base.diskFreeGB = (stats.bsize * stats.bavail) / 1024 ** 3;
      base.diskTotalGB = (stats.bsize * stats.blocks) / 1024 ** 3;
    }
  } catch {
    // statfs not available — skip disk info
  }

  return base;
}

// ─── 3. Project context ────────────────────────────────────────────────��──────

const FRAMEWORK_PKGS: Record<string, string> = {
  react: "React", vue: "Vue", svelte: "Svelte", "@angular/core": "Angular",
  "solid-js": "Solid", next: "Next.js", nuxt: "Nuxt", "@remix-run/node": "Remix",
  astro: "Astro", express: "Express", fastify: "Fastify", koa: "Koa",
  hono: "Hono", "@nestjs/core": "NestJS", "socket.io": "Socket.IO",
  vite: "Vite", webpack: "webpack", esbuild: "esbuild", rollup: "Rollup",
  parcel: "Parcel", ink: "Ink", electron: "Electron", "@tauri-apps/api": "Tauri",
  "@prisma/client": "Prisma", prisma: "Prisma", drizzle: "Drizzle",
  typeorm: "TypeORM", sequelize: "Sequelize", mongoose: "Mongoose",
  graphql: "GraphQL", "@trpc/server": "tRPC", tailwindcss: "Tailwind",
  jest: "Jest", vitest: "Vitest", playwright: "Playwright", cypress: "Cypress",
};

async function gatherProject(workspaceRoot: string): Promise<ProjectInfo | null> {
  const pkgPath = await findUpward("package.json", workspaceRoot);
  if (!pkgPath) return null;

  const raw = await tryReadFile(pkgPath);
  if (!raw) return null;

  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }

  const projectDir = path.dirname(pkgPath);

  // Package manager from lockfiles
  const lockfiles: [string, string][] = [
    ["bun.lockb", "bun"], ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"], ["package-lock.json", "npm"],
  ];
  let pm = "unknown";
  for (const [file, name] of lockfiles) {
    try { await access(path.join(projectDir, file)); pm = name; break; }
    catch { /* next */ }
  }

  // Framework detection from deps
  const allDeps = {
    ...pkg["dependencies"] as Record<string, unknown> | undefined,
    ...pkg["devDependencies"] as Record<string, unknown> | undefined,
  };
  const frameworks = Object.keys(allDeps)
    .filter((d) => FRAMEWORK_PKGS[d])
    .map((d) => FRAMEWORK_PKGS[d]!)
    .filter((v, i, a) => a.indexOf(v) === i)  // unique
    .slice(0, 8);

  const scripts = Object.keys((pkg["scripts"] as Record<string, unknown>) ?? {}).slice(0, 12);
  const workspaces = pkg["workspaces"] as string[] | undefined;
  const moduleType = pkg["type"] === "module" ? "esm" : pkg["type"] === "commonjs" ? "cjs" : "unknown";

  return {
    name: (pkg["name"] as string | undefined) ?? path.basename(projectDir),
    isMonorepo: Array.isArray(workspaces) && workspaces.length > 0,
    packageManager: pm,
    scripts,
    frameworks,
    workspaceCount: Array.isArray(workspaces) ? workspaces.length : undefined,
    moduleType,
  };
}

// ─── 4. Git context ───────────────────────────────────────────────────────────

async function gatherGit(workspaceRoot: string): Promise<GitInfo | null> {
  const gitDir = await findUpward(".git", workspaceRoot);
  if (!gitDir) return null;

  const gitWorkTree = path.dirname(gitDir);

  const headRaw = await tryReadFile(gitDir);
  if (!headRaw) return null;

  // .git is a directory — headRaw is a file we tried to read as text which will fail.
  // We need to read .git/HEAD
  const headContent = await tryReadFile(path.join(path.dirname(gitDir), ".git", "HEAD")) ??
                      await tryReadFile(path.join(gitDir, "HEAD"));
  if (!headContent) return null;

  const branchMatch = headContent.trim().match(/^ref: refs\/heads\/(.+)$/);
  const branch = branchMatch ? branchMatch[1]! : headContent.trim().slice(0, 12) + " (detached)";

  // Read commit message
  const commitMsg = (await tryReadFile(
    path.join(path.dirname(gitDir), ".git", "COMMIT_EDITMSG")
  ) ?? await tryReadFile(path.join(gitDir, "COMMIT_EDITMSG")) ?? "")
    .split("\n")[0]?.trim() ?? "";

  // Read commit hash from refs
  const refFile = branchMatch
    ? await tryReadFile(path.join(path.dirname(gitDir), ".git", `refs/heads/${branch}`)) ??
      await tryReadFile(path.join(gitDir, `refs/heads/${branch}`))
    : null;
  const commitHash = refFile ? refFile.trim().slice(0, 7) : "unknown";

  // Parse remote URL from .git/config
  const gitConfig = await tryReadFile(path.join(path.dirname(gitDir), ".git", "config")) ??
                    await tryReadFile(path.join(gitDir, "config")) ?? "";
  const remoteMatch = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
  const remoteUrl = remoteMatch ? remoteMatch[1]!.trim() : null;

  // Check for stash
  const stashExists = !!(await tryReadFile(
    path.join(path.dirname(gitDir), ".git", "refs/stash")
  ) ?? await tryReadFile(path.join(gitDir, "refs/stash")));

  // Git status + commit age (shell calls — fast)
  const [statusOut, ageOut] = await Promise.all([
    exec("git", ["status", "--short", "--porcelain"], 800, gitWorkTree),
    exec("git", ["log", "-1", "--format=%cr"], 800, gitWorkTree),
  ]);

  const isDirty = !!(statusOut && statusOut.trim().length > 0);
  const commitAge = ageOut ?? "unknown";

  return {
    branch,
    commitHash,
    commitMessage: commitMsg.slice(0, 72),
    commitAge,
    remoteUrl,
    isDirty,
    stashCount: stashExists ? 1 : 0, // simplified — just "has stash or not"
  };
}

// ─── 5. Installed tools probe ─────────────────────────────────────────────────

interface ToolProbe {
  name: string;
  commands: Array<[string, string[]]>;
}

const TOOL_PROBES: ToolProbe[] = [
  { name: "git",    commands: [["git",     ["--version"]]] },
  { name: "python", commands: [["python3", ["--version"]], ["python", ["--version"]], ["py", ["--version"]]] },
  { name: "pip",    commands: [["pip3",    ["--version"]], ["pip",    ["--version"]]] },
  { name: "docker", commands: [["docker",  ["--version"]]] },
  { name: "go",     commands: [["go",      ["version"]]] },
  { name: "rustc",  commands: [["rustc",   ["--version"]]] },
  { name: "java",   commands: [["java",    ["--version"]]] },
  { name: "ruby",   commands: [["ruby",    ["--version"]]] },
  { name: "curl",   commands: [["curl",    ["--version"]]] },
  { name: "jq",     commands: [["jq",      ["--version"]]] },
  { name: "make",   commands: [["make",    ["--version"]]] },
  ...(process.platform === "win32"
    ? [{ name: "wsl", commands: [["wsl", ["--version"]]] as Array<[string, string[]]> }]
    : []),
];

async function probeOneTool(probe: ToolProbe): Promise<{ name: string; version: string } | null> {
  for (const [cmd, args] of probe.commands) {
    const out = await exec(cmd, args, 300);
    if (out !== null) {
      const ver = out.match(/(\d+\.\d+[\.\d]*)/)?.[1] ?? out.split("\n")[0]?.slice(0, 30) ?? "?";
      return { name: probe.name, version: ver };
    }
  }
  return null;
}

async function probeInstalledTools(): Promise<ToolVersions> {
  const results = await Promise.all(TOOL_PROBES.map((p) => probeOneTool(p)));
  const found: ToolVersions["found"] = [];
  const notFound: string[] = [];
  for (let i = 0; i < TOOL_PROBES.length; i++) {
    const r = results[i];
    if (r) found.push(r);
    else notFound.push(TOOL_PROBES[i]!.name);
  }
  return { found, notFound };
}

// ─── 6. Active ports ──────────────────────────────────────────────────────────

const DEV_PORTS = [3000, 3001, 3002, 4000, 4200, 5000, 5001, 5173, 5174, 8000, 8080, 8888, 9000, 9229];

async function scanActivePorts(): Promise<PortInfo> {
  try {
    let output: string | null;
    if (process.platform === "win32") {
      output = await exec("netstat", ["-ano", "-p", "TCP"], 2000);
    } else {
      output = await exec("ss", ["-tlnp"], 1500) ?? await exec("netstat", ["-tlnp"], 1500);
    }
    if (!output) return { busy: [], free: DEV_PORTS };

    const listening = new Set<number>();
    if (process.platform === "win32") {
      // "  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    1234"
      for (const match of output.matchAll(/TCP\s+\S+:(\d+)\s+\S+\s+LISTENING/gi)) {
        listening.add(parseInt(match[1]!, 10));
      }
    } else {
      // Both ss and netstat: lines with LISTEN contain ":<port> "
      for (const line of output.split("\n")) {
        if (!/LISTEN/i.test(line)) continue;
        const m = line.match(/:(\d+)\s/);
        if (m) listening.add(parseInt(m[1]!, 10));
      }
    }

    return {
      busy: DEV_PORTS.filter((p) => listening.has(p)),
      free: DEV_PORTS.filter((p) => !listening.has(p)),
    };
  } catch {
    return { busy: [], free: DEV_PORTS };
  }
}

// ─── 7. Environment variable inventory (synchronous) ─────────────────────────

const ENV_CATEGORIES: Record<string, string[]> = {
  database: ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_HOST", "MYSQL_URL", "MONGO_URI",
             "MONGODB_URI", "REDIS_URL", "REDIS_HOST", "SQLITE_PATH"],
  apiKeys:  ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
             "STRIPE_SECRET_KEY", "SENDGRID_API_KEY", "TWILIO_AUTH_TOKEN",
             "AWS_ACCESS_KEY_ID", "GCP_PROJECT_ID", "AZURE_SUBSCRIPTION_ID",
             "GITHUB_TOKEN", "GITLAB_TOKEN", "CLOUDFLARE_API_TOKEN"],
  runtime:  ["NODE_ENV", "PORT", "HOST", "DEBUG", "LOG_LEVEL", "TZ"],
  ci:       ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS",
             "VERCEL", "RAILWAY", "RENDER", "HEROKU_APP_NAME", "FLY_APP_NAME"],
  proxy:    ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"],
};

const ALL_WATCHED = Object.values(ENV_CATEGORIES).flat();

function gatherEnvInventory(): EnvInventory {
  const set: string[] = [];
  const unset: string[] = [];
  for (const key of ALL_WATCHED) {
    if (process.env[key] !== undefined) {
      // Include NODE_ENV value since it's not sensitive
      const label = key === "NODE_ENV" ? `${key}=${process.env[key]!}` : key;
      set.push(label);
    } else {
      unset.push(key);
    }
  }
  return { set, unset };
}

// ─── 8. Code style ────────────────────────────────────────────────────────────

async function gatherCodeStyle(workspaceRoot: string): Promise<CodeStyle | null> {
  // Try Prettier config first
  for (const name of [".prettierrc", ".prettierrc.json"]) {
    const fp = await findUpward(name, workspaceRoot);
    if (!fp) continue;
    const raw = await tryReadFile(fp);
    if (!raw) continue;
    try {
      const cfg = JSON.parse(raw) as Record<string, unknown>;
      return {
        indentStyle: cfg["useTabs"] ? "tab" : "space",
        indentSize: typeof cfg["tabWidth"] === "number" ? cfg["tabWidth"] : 2,
        quotes: cfg["singleQuote"] === true ? "single" : "double",
        semi: typeof cfg["semi"] === "boolean" ? cfg["semi"] : true,
        lineEndings: cfg["endOfLine"] === "crlf" ? "crlf"
                   : cfg["endOfLine"] === "cr"   ? "cr"   : "lf",
        printWidth: typeof cfg["printWidth"] === "number" ? cfg["printWidth"] : null,
        source: name,
      };
    } catch { /* malformed — try next */ }
  }

  // Try .editorconfig
  const editorConfigPath = await findUpward(".editorconfig", workspaceRoot);
  if (editorConfigPath) {
    const raw = await tryReadFile(editorConfigPath);
    if (raw) {
      const style: CodeStyle = {
        indentStyle: null, indentSize: null, quotes: null,
        semi: null, lineEndings: null, printWidth: null,
        source: ".editorconfig",
      };
      let inGlobSection = false;
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[")) {
          // Match [*], [*.ts], [*.{js,ts,tsx}] — general source file sections
          inGlobSection = /^\[\*\]$|^\[\*\.\{[^}]*[jt]s/.test(trimmed);
          continue;
        }
        if (!inGlobSection) continue;
        const [k, v] = trimmed.split("=").map((s) => s.trim().toLowerCase());
        if (!k || !v) continue;
        if (k === "indent_style") style.indentStyle = v === "tab" ? "tab" : "space";
        if (k === "indent_size") style.indentSize = parseInt(v, 10) || null;
        if (k === "end_of_line") style.lineEndings = v === "crlf" ? "crlf" : v === "cr" ? "cr" : "lf";
      }
      if (style.indentStyle !== null) return style;
    }
  }

  return null;
}

// ─── 9a. Vault summary (Obsidian brain) ──────────────────────────────────────

const VAULT_TYPE_FOLDERS = [
  "Facts",
  "Entities",
  "Reflections",
  "Recipes",
  "Tasks",
  "Notes",
  "Episodes",
] as const;

interface VaultNoteSummary {
  title: string;
  type: string;
  updated: string;
}

interface VaultContextSummary {
  totalNotes: number;
  countByType: Record<string, number>;
  recentNotes: VaultNoteSummary[];
}

/** Minimal frontmatter extraction — reads title, type, updated from a .md file header. */
function extractVaultFrontmatterFields(raw: string): { title?: string; type?: string; updated?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "title" || key === "type" || key === "updated") {
      fm[key] = val;
    }
  }
  return fm;
}

async function gatherVaultSummary(): Promise<VaultContextSummary | null> {
  const vaultDir = getAgentVaultRoot();

  const countByType: Record<string, number> = {};
  const allNotes: VaultNoteSummary[] = [];

  for (const folder of VAULT_TYPE_FOLDERS) {
    const dir = path.join(vaultDir, folder);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await readFile(path.join(dir, file), "utf8");
        const fm = extractVaultFrontmatterFields(raw);
        const type = fm.type ?? folder.toLowerCase().slice(0, -1); // remove plural 's'
        countByType[type] = (countByType[type] ?? 0) + 1;
        allNotes.push({
          title:   fm.title   ?? file.slice(0, -3),
          type,
          updated: fm.updated ?? "",
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  if (allNotes.length === 0) return null;

  allNotes.sort((a, b) => b.updated.localeCompare(a.updated));
  return {
    totalNotes: allNotes.length,
    countByType,
    recentNotes: allNotes.slice(0, 5),
  };
}

// ─── 9. Session memory prefetch ───────────────────────────────────────────────

/** Stored note format — may be plain string (legacy) or timestamped object (new). */
type MaybeStoredNote =
  | string
  | {
      value: string;
      createdAt?: string;
      updatedAt?: string;
      lastAccessedAt?: string;
      accessCount?: number;
      confidence?: number;
    };

function extractNoteValue(note: MaybeStoredNote): string {
  return typeof note === "string" ? note : (note.value ?? "");
}

function extractNoteUpdatedAt(note: MaybeStoredNote): string | undefined {
  return typeof note === "string" ? undefined : note.updatedAt;
}

async function gatherSessionMemory(workspaceRoot: string): Promise<SessionMemory | null> {
  const notesFile = path.join(workspaceRoot, ".agent_notes.json");
  const projBasename = path.basename(workspaceRoot).toLowerCase();
  const raw = await tryReadFile(notesFile);
  if (!raw) return null;

  let rawNotes: Record<string, MaybeStoredNote>;
  try { rawNotes = JSON.parse(raw) as Record<string, MaybeStoredNote>; }
  catch { return null; }

  const facts: SessionMemory["facts"] = [];
  const experiences: SessionMemory["experiences"] = [];
  const entities: SessionMemory["entities"] = [];
  const reflectionCandidates: Array<{ value: string; updatedAt?: string }> = [];
  const recipeCandidates: Array<{ value: string; updatedAt?: string }> = [];
  const countByType: Record<string, number> = {};

  for (const [fullKey, rawEntry] of Object.entries(rawNotes)) {
    const value = extractNoteValue(rawEntry);
    const updatedAt = extractNoteUpdatedAt(rawEntry);
    const colonIdx = fullKey.indexOf(":");
    const type = colonIdx > 0 ? fullKey.slice(0, colonIdx) : "general";
    const key  = colonIdx > 0 ? fullKey.slice(colonIdx + 1) : fullKey;

    // Count all entries by type (for summary)
    countByType[type] = (countByType[type] ?? 0) + 1;

    if (type === "fact") {
      facts.push({ key, value: value.slice(0, 100) });
    } else if (type === "experience") {
      experiences.push({ key, value: value.slice(0, 120) });
    } else if (type === "entity") {
      // Only include entity memories relevant to this project
      if (key.toLowerCase().includes(projBasename) || value.toLowerCase().includes(projBasename)) {
        entities.push({ key, value: value.slice(0, 100) });
      }
    } else if (type === "reflection") {
      // Collect for recency-sorted injection (Reflexion protocol)
      reflectionCandidates.push({ value, updatedAt });
    } else if (type === "recipe") {
      // Collect successful tool patterns for session start
      recipeCandidates.push({ value, updatedAt });
    }
    // Skip harness:* — too verbose (improvement suggestions)
  }

  // Keep only the 2 most recent experience entries (keys often contain dates/timestamps)
  experiences.sort((a, b) => b.key.localeCompare(a.key));
  experiences.splice(2);

  // Sort reflections by recency (newest first), keep top 3, condense to 120 chars
  reflectionCandidates.sort((a, b) => {
    const aT = a.updatedAt ?? "";
    const bT = b.updatedAt ?? "";
    return bT.localeCompare(aT);
  });
  const reflections = reflectionCandidates.slice(0, 3).map((r) => ({
    value: r.value.slice(0, 120) + (r.value.length > 120 ? "…" : ""),
  }));

  // Sort recipes by recency, keep top 2
  recipeCandidates.sort((a, b) => {
    const aT = a.updatedAt ?? "";
    const bT = b.updatedAt ?? "";
    return bT.localeCompare(aT);
  });
  const recipes = recipeCandidates.slice(0, 2).map((r) => ({
    value: r.value.slice(0, 120) + (r.value.length > 120 ? "…" : ""),
  }));

  const totalCount = Object.values(countByType).reduce((a, b) => a + b, 0);
  const total = facts.length + experiences.length + entities.length + reflections.length + recipes.length;
  return total > 0 || totalCount > 0
    ? { facts, experiences, entities, reflections, recipes, totalCount, countByType }
    : null;
}

/** BM25-ranked lines for session priming from notes + vault (no embeddings). */
async function gatherRelevantPrimedLines(
  seed: string,
  maxNotes: number,
  maxVault: number,
  workspaceRoot: string
): Promise<string[]> {
  const trimmed = seed.trim();
  if (trimmed.length < 2) return [];

  const lines: string[] = [];
  const notesFile = path.join(workspaceRoot, ".agent_notes.json");
  const memoryEmbedIndexPath = path.join(workspaceRoot, ".agent_memory.index.json");

  const rawNotes = await tryReadFile(notesFile);
  if (rawNotes) {
    try {
      const parsed = JSON.parse(rawNotes) as Record<string, MaybeStoredNote>;
      const docs: RankableDoc[] = [];
      for (const [fullKey, rawEntry] of Object.entries(parsed)) {
        const value = extractNoteValue(rawEntry);
        const updatedAt = extractNoteUpdatedAt(rawEntry);
        const colonIdx = fullKey.indexOf(":");
        const memType = colonIdx > 0 ? fullKey.slice(0, colonIdx) : undefined;
        const accessCount =
          typeof rawEntry === "object" && rawEntry !== null && "accessCount" in rawEntry
            ? (rawEntry as { accessCount?: number }).accessCount
            : undefined;
        const confidence =
          typeof rawEntry === "object" && rawEntry !== null && "confidence" in rawEntry
            ? (rawEntry as { confidence?: number }).confidence
            : undefined;
        docs.push({
          id: fullKey,
          text: `${fullKey} ${value}`,
          updatedAt,
          memoryType: memType,
          accessCount,
          confidence,
        });
      }
      const bmRanked = rankDocumentsForQuery(trimmed, docs, { limit: Math.max(maxNotes * 4, 48) });
      const bmMax = Math.max(...bmRanked.map((r) => r.score), 1e-9);
      const bmById = new Map<string, number>();
      for (const r of bmRanked) bmById.set(r.id, r.score / bmMax);

      const embedModel = process.env["AGENT_EMBED_MODEL"]?.trim();
      const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
      const baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
        /\/$/,
        ""
      );

      let orderedNoteIds: string[] = bmRanked.slice(0, maxNotes).map((r) => r.id);

      if (embedModel && apiKey) {
        try {
          const rawIdx = await tryReadFile(memoryEmbedIndexPath);
          if (rawIdx) {
            const idx = JSON.parse(rawIdx) as { entries?: Record<string, { v?: number[] }> };
            const { vectors } = await fetchEmbeddings({
              apiKey,
              baseURL,
              model: embedModel,
              inputs: [trimmed.slice(0, 8000)],
            });
            const qv = vectors[0];
            if (qv?.length) {
              const semById = new Map<string, number>();
              let semMax = 1e-9;
              for (const [key, row] of Object.entries(idx.entries ?? {})) {
                const v = row?.v;
                if (!v?.length || v.length !== qv.length) continue;
                const s = cosineSimilarity(qv, v);
                semById.set(key, s);
                if (s > semMax) semMax = s;
              }
              const allIds = new Set<string>([...bmById.keys(), ...semById.keys()]);
              const fused: Array<{ id: string; score: number }> = [];
              for (const id of allIds) {
                const bm = bmById.get(id) ?? 0;
                const sem = (semById.get(id) ?? 0) / semMax;
                const hybrid = 0.55 * sem + 0.35 * bm + 0.1 * Math.max(sem, bm);
                if (hybrid < 0.02) continue;
                fused.push({ id, score: hybrid });
              }
              fused.sort((a, b) => b.score - a.score);
              if (fused.length > 0) {
                orderedNoteIds = fused.slice(0, maxNotes).map((x) => x.id);
              }
            }
          }
        } catch {
          /* embeddings optional — keep BM25 order */
        }
      }

      for (const id of orderedNoteIds) {
        const rawEntry = parsed[id];
        const v = extractNoteValue(rawEntry ?? "");
        lines.push(`[${id}] ${v.slice(0, 160)}${v.length > 160 ? "…" : ""}`);
      }
    } catch {
      /* malformed JSON */
    }
  }

  const vaultDir = getAgentVaultRoot();
  const vaultDocs: RankableDoc[] = [];
  for (const folder of VAULT_TYPE_FOLDERS) {
    const dir = path.join(vaultDir, folder);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const fp = path.join(dir, file);
        const rawMd = await readFile(fp, "utf8");
        const fm = extractVaultFrontmatterFields(rawMd);
        const body = rawMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
        const title = fm.title ?? file.slice(0, -3);
        const typ = fm.type ?? folder.toLowerCase().slice(0, -1);
        const text = `${title} ${typ} ${body.slice(0, 1500)}`;
        vaultDocs.push({
          id: title,
          text,
          updatedAt: fm.updated,
          memoryType: typ,
        });
      } catch {
        /* skip */
      }
    }
  }
  if (vaultDocs.length > 0) {
    const vr = rankDocumentsForQuery(trimmed, vaultDocs, { limit: maxVault });
    for (const r of vr) {
      lines.push(`Vault: [[${r.id}]]`);
    }
  }

  return lines;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function sep(title: string) {
  return `\n── ${title} ${"─".repeat(Math.max(2, 52 - title.length))}`;
}

function fmtGB(gb: number): string {
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function resolveSessionMode(
  options?: WorldContextOptions
): "initializer" | "coding" | undefined {
  if (options?.sessionMode === "initializer" || options?.sessionMode === "coding") {
    return options.sessionMode;
  }
  const raw = process.env["AGENT_SESSION_MODE"]?.trim().toLowerCase();
  if (raw === "initializer" || raw === "coding") return raw;
  return undefined;
}

function sessionModeLines(mode: "initializer" | "coding"): string[] {
  if (mode === "initializer") {
    return [
      sep("Session mode (INITIALIZER)"),
      "This is the first session for a long-horizon goal. Before heavy implementation:",
      "- Create agent_features.json (use feature_checklist) with granular items; set passes only after verification.",
      "- Add AGENT_PROGRESS.md and append a short log after each milestone.",
      "- Add init.sh (or document scripts) so later sessions can run the app and smoke-test quickly.",
      "- Make an initial git commit when scaffolding is stable.",
    ];
  }
  return [
    sep("Session mode (CODING)"),
    "Incremental work session. At start: read AGENT_PROGRESS.md (if present), agent_features.json, and git log.",
    "Pick one failing or incomplete feature; finish it; verify; update passes and progress; leave merge-ready state.",
  ];
}

interface TaskNotePayload {
  id?: string;
  goal?: string;
  progress_summary?: string;
  next_steps?: string[];
  status?: string;
  updatedAt?: string;
}

/** Resume snippets: progress file tail, latest in-progress task:* note, feature checklist preview. */
async function gatherLongHorizonHandoffLines(workspaceRoot: string): Promise<string[]> {
  const out: string[] = [];
  const progressPath = path.join(workspaceRoot, "AGENT_PROGRESS.md");
  const progress = await tryReadFile(progressPath);
  if (progress?.trim()) {
    const tail = progress.trim().slice(-1200);
    out.push(sep("Long-horizon resume"));
    out.push("AGENT_PROGRESS.md (tail):");
    out.push(tail);
  }

  const notesPath = path.join(workspaceRoot, ".agent_notes.json");
  const notesRaw = await tryReadFile(notesPath);
  if (notesRaw) {
    try {
      const parsed = JSON.parse(notesRaw) as Record<string, unknown>;
      let best: { key: string; payload: TaskNotePayload; t: number } | null = null;
      for (const [key, val] of Object.entries(parsed)) {
        if (!key.startsWith("task:")) continue;
        const str = typeof val === "string" ? val : JSON.stringify(val);
        let payload: TaskNotePayload;
        try {
          payload = JSON.parse(str) as TaskNotePayload;
        } catch {
          continue;
        }
        if (payload.status !== "in_progress") continue;
        const t = Date.parse(payload.updatedAt ?? "") || 0;
        if (!best || t > best.t) best = { key, payload, t };
      }
      if (best?.payload) {
        const p = best.payload;
        out.push(sep("Active task (from memory)"));
        out.push(`Key: ${best.key}`);
        if (p.goal)
          out.push(`Goal: ${p.goal.slice(0, 400)}${p.goal.length > 400 ? "…" : ""}`);
        if (p.progress_summary)
          out.push(`Progress: ${p.progress_summary.slice(0, 600)}${p.progress_summary.length > 600 ? "…" : ""}`);
        if (p.next_steps?.length)
          out.push(`Next steps: ${p.next_steps.slice(0, 8).join(" → ")}`);
      }
    } catch {
      /* ignore malformed notes */
    }
  }

  const featPath = path.join(workspaceRoot, "agent_features.json");
  const feat = await tryReadFile(featPath);
  if (feat?.trim()) {
    out.push(sep("Feature checklist (preview)"));
    out.push(feat.trim().slice(0, 2500) + (feat.length > 2500 ? "\n…[truncated]" : ""));
  }

  return out;
}

// ─── 10. MCP environment signals ─────────────────────────────────────────────

const MCP_CREDENTIAL_VARS: ReadonlyArray<[envVar: string, label: string]> = [
  ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
  ["GITHUB_TOKEN", "GITHUB_TOKEN"],
  ["GITLAB_PERSONAL_ACCESS_TOKEN", "GITLAB_PERSONAL_ACCESS_TOKEN"],
  ["GITLAB_TOKEN", "GITLAB_TOKEN"],
  ["SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN"],
  ["NOTION_API_KEY", "NOTION_API_KEY"],
  ["NOTION_TOKEN", "NOTION_TOKEN"],
  ["LINEAR_API_KEY", "LINEAR_API_KEY"],
  ["BRAVE_API_KEY", "BRAVE_API_KEY"],
  ["POSTGRES_URL", "POSTGRES_URL"],
  ["DATABASE_URL", "DATABASE_URL"],
  ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS"],
];

interface McpEnvSection {
  lines: string[];
}

async function gatherMcpEnvironmentSection(workspaceRoot: string): Promise<McpEnvSection | null> {
  const detectedVars: string[] = [];
  for (const [varName] of MCP_CREDENTIAL_VARS) {
    if (process.env[varName]) detectedVars.push(varName);
  }

  // git remote host from .git/config (fast file read, no shell)
  let gitRemoteHost: string | null = null;
  try {
    const gitConfigRaw = await readFile(path.join(workspaceRoot, ".git", "config"), "utf-8");
    const m = gitConfigRaw.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
    if (m) {
      const u = m[1]!.trim();
      if (u.includes("github.com")) gitRemoteHost = "github.com";
      else if (u.includes("gitlab.com")) gitRemoteHost = "gitlab.com";
      else if (u.includes("bitbucket.org")) gitRemoteHost = "bitbucket.org";
    }
  } catch { /* no git or not reachable */ }

  // local .db / .sqlite files in workspace root
  let localDbFiles: string[] = [];
  try {
    const entries = await readdir(workspaceRoot);
    localDbFiles = entries.filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f));
  } catch { /* ignore */ }

  const parts: string[] = [];
  if (gitRemoteHost) parts.push(`Git remote: ${gitRemoteHost}`);
  if (detectedVars.length > 0) parts.push(`Credentials in env: ${detectedVars.join(", ")}`);
  if (localDbFiles.length > 0) parts.push(`Local databases: ${localDbFiles.join(", ")}`);

  if (parts.length === 0) return null;

  return {
    lines: [
      ...parts,
      `→ mcp_suggest("<capability>") to find and connect the right MCP server automatically.`,
    ],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the world context string to inject at session start.
 * Async — runs all 10 gatherers in parallel with a 1500ms hard ceiling.
 * Returns null only if options.disabled === true.
 */
export async function buildWorldContextMessage(options?: WorldContextOptions): Promise<string | null> {
  if (options?.disabled === true) return null;

  const workspaceRoot = path.resolve(
    options?.workspaceRoot?.trim() || resolveWorkspaceRoot()
  );
  const processCwd = process.cwd();

  const TIMEOUT = 1500;

  // Parallel gather — all results degrade to null on timeout/error
  const [resources, project, git, tools, ports, style, memory, vault, repoMapLines, mcpEnv] = await Promise.all([
    withDeadline(gatherResources(workspaceRoot), TIMEOUT),
    withDeadline(gatherProject(workspaceRoot), TIMEOUT),
    withDeadline(gatherGit(workspaceRoot), TIMEOUT),
    withDeadline(probeInstalledTools(), TIMEOUT),
    withDeadline(scanActivePorts(), TIMEOUT),
    withDeadline(gatherCodeStyle(workspaceRoot), TIMEOUT),
    withDeadline(gatherSessionMemory(workspaceRoot), TIMEOUT),
    withDeadline(gatherVaultSummary(), TIMEOUT),
    withDeadline(gatherRepoMapLines({ scope: "packages", root: workspaceRoot }), TIMEOUT),
    withDeadline(gatherMcpEnvironmentSection(workspaceRoot), TIMEOUT),
  ]);

  // ── Core system ──────────────────────────────────────────────────────────────
  const now = new Date();
  const isoDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const isoTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
  const dow     = now.toLocaleDateString("en-US", { weekday: "long" });
  const tz      = getTimezone();
  const offset  = getUtcOffset();
  const shell   = getShell();
  const osLabel = getOSLabel();
  const cwd     = workspaceRoot;
  const user    = getUsername();
  const home    = os.homedir();
  const host    = os.hostname();

  const lines: string[] = [
    `[WORLD CONTEXT — session grounding, ${isoDate} ${isoTime}]`,
    ``,
    `Date/Time:  ${dow}, ${isoDate}  ${isoTime}  (${offset} · ${tz})`,
    ...(options?.location ? [`Location:   ${options.location}`] : []),
  ];

  // Platform + resources on one line
  if (resources) {
    const ramLine = `${fmtGB(resources.freeRamGB)} free / ${fmtGB(resources.totalRamGB)} RAM  ·  ${resources.cpuCount} cores ${resources.cpuModel}`;
    const diskLine = resources.diskFreeGB !== null
      ? `  ·  Disk: ${fmtGB(resources.diskFreeGB)} free / ${fmtGB(resources.diskTotalGB ?? 0)}`
      : "";
    lines.push(`Platform:   ${osLabel}`);
    lines.push(`Resources:  ${ramLine}${diskLine}`);
  } else {
    lines.push(`Platform:   ${osLabel}`);
  }

  lines.push(`Shell:      ${shell}  —  ${getShellNote(shell)}`);
  lines.push(`CWD:        ${cwd}`);
  lines.push(`OS account: ${user} @ ${host}  →  ${home}  (system username — not necessarily the user's preferred name; check memory for actual name)`);
  lines.push(`Runtime:    Node.js ${process.version}`);
  const configuredModel = process.env["AGENT_MODEL"]?.trim() || "openrouter/owl-alpha";
  const configuredBaseURL =
    process.env["AGENT_API_BASE_URL"]?.trim() || "https://openrouter.ai/api/v1";
  lines.push(`Harness:    Liminal AgentHarness`);
  lines.push(`LLM config: model=${configuredModel}  ·  baseURL=${configuredBaseURL}`);

  // ── Project ──────────────────────────────────────────────────────────────────
  if (project) {
    lines.push(sep("Project"));
    const typeTag = project.isMonorepo
      ? `${project.moduleType} monorepo · ${project.workspaceCount} workspaces`
      : project.moduleType;
    lines.push(`${project.name}  ·  ${typeTag}  ·  ${project.packageManager}`);
    if (project.scripts.length > 0) lines.push(`Scripts:  ${project.scripts.join("  ·  ")}`);
    if (project.frameworks.length > 0) lines.push(`Deps:     ${project.frameworks.join("  ·  ")}`);
  }

  if (repoMapLines && repoMapLines.length > 0) {
    lines.push(sep("Repo map"));
    for (const ln of repoMapLines.slice(0, 80)) lines.push(ln);
  }

  // ── Git ──────────────────────────────────────────────────────────────────────
  if (git) {
    lines.push(sep("Git"));
    const status = git.isDirty ? "DIRTY (uncommitted changes)" : "clean";
    const stash = git.stashCount > 0 ? `  ·  stash: ${git.stashCount}` : "";
    lines.push(`Branch:  ${git.branch}  ·  ${status}${stash}`);
    lines.push(`Commit:  ${git.commitHash}  "${git.commitMessage}"  (${git.commitAge})`);
    if (git.remoteUrl) lines.push(`Remote:  ${git.remoteUrl}`);
  }

  // ── Installed tools ───────────────────────────────────────────────────────────
  if (tools) {
    lines.push(sep("Installed Tools"));
    if (tools.found.length > 0) {
      lines.push(tools.found.map((t) => `${t.name} ${t.version}`).join("  ·  "));
    }
    if (tools.notFound.length > 0) {
      lines.push(`NOT found:  ${tools.notFound.join("  ·  ")}`);
    }
  }

  // ── Active ports ─────────────────────────────────────────────────────────────
  if (ports && (ports.busy.length > 0 || ports.free.length > 0)) {
    lines.push(sep("Active Ports"));
    if (ports.busy.length > 0) lines.push(`In use:  ${ports.busy.map((p) => `:${p}`).join("  ")}`);
    if (ports.free.length > 0) lines.push(`Free:    ${ports.free.map((p) => `:${p}`).join("  ")}`);
  }

  // ── Environment ───────────────────────────────────────────────────────────────
  const env = gatherEnvInventory(); // sync
  {
    lines.push(sep("Environment"));
    if (env.set.length > 0)   lines.push(`Set:    ${env.set.join("  ·  ")}`);
    if (env.unset.length > 0) lines.push(`Unset:  ${env.unset.join("  ·  ")}`);
  }

  // ── Code style ────────────────────────────────────────────────────────────────
  if (style) {
    lines.push(sep("Code Style"));
    const parts = [
      style.indentStyle ? (style.indentStyle === "tab" ? "tabs" : `${style.indentSize ?? 2} spaces`) : null,
      style.quotes ? `${style.quotes} quotes` : null,
      style.semi !== null ? (style.semi ? "semicolons" : "no semicolons") : null,
      style.lineEndings ? style.lineEndings.toUpperCase() : null,
      style.printWidth ? `${style.printWidth} cols` : null,
    ].filter(Boolean);
    lines.push(`${parts.join("  ·  ")}  [${style.source}]`);
  }

  // ── Session memory ────────────────────────────────────────────────────────────
  if (memory && memory.totalCount > 0) {
    lines.push(sep("Session Memory"));
    // Summary line — agent knows what it knows at a glance
    const breakdown = Object.entries(memory.countByType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, n]) => `${n} ${t}`)
      .join(", ");
    lines.push(`Memory: ${memory.totalCount} stored (${breakdown})`);
    // Facts and entities
    for (const { key, value } of memory.facts)
      lines.push(`[fact] ${key} → ${value}`);
    for (const { key, value } of memory.entities)
      lines.push(`[entity] ${key} → ${value}`);
    for (const { key, value } of memory.experiences)
      lines.push(`[exp:${key}] ${value}`);
    // Past failure lessons (Reflexion protocol — surfaces what was previously skipped)
    if (memory.reflections.length > 0) {
      lines.push(`Past failure lessons (${memory.reflections.length}):`);
      for (const { value } of memory.reflections)
        lines.push(`  - ${value}`);
    }
    // Successful patterns
    if (memory.recipes.length > 0) {
      lines.push(`Successful patterns (${memory.recipes.length}):`);
      for (const { value } of memory.recipes)
        lines.push(`  - ${value}`);
    }
  }

  // ── Relevant memory (BM25 seed from first user message) ─────────────────────
  if (options?.firstUserMessage?.trim()) {
    const seed = options.firstUserMessage.trim();
    const primed = await withDeadline(
      gatherRelevantPrimedLines(seed, 6, 6, workspaceRoot),
      TIMEOUT
    );
    if (primed && primed.length > 0) {
      lines.push(sep("Relevant memory"));
      for (const ln of primed) lines.push(ln);
    }
    const failureDig = await withDeadline(formatFailureDigestForWorldContext(), 400);
    if (failureDig) {
      lines.push(sep("Failure digest"));
      lines.push(failureDig);
    }
    const golden = await withDeadline(formatGoldenEvalHints(seed), 400);
    if (golden) {
      lines.push(sep("Golden eval demos"));
      lines.push(golden);
    }
    const recipeLib = await withDeadline(formatRecipeLibraryHints(seed), 400);
    if (recipeLib) {
      lines.push(sep("Recipe library"));
      lines.push(recipeLib);
    }
  }

  // ── MCP environment ───────────────────────────────────────────────────────────
  if (mcpEnv) {
    lines.push(sep("MCP environment"));
    for (const ln of mcpEnv.lines) lines.push(ln);
  }

  // ── Vault (Obsidian brain) ────────────────────────────────────────────────────
  if (vault && vault.totalNotes > 0) {
    lines.push(sep("Knowledge Vault"));
    const breakdown = Object.entries(vault.countByType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, n]) => `${n} ${t}`)
      .join(", ");
    lines.push(`Vault: ${vault.totalNotes} notes (${breakdown})`);
    lines.push(`Recent: ${vault.recentNotes.map((n) => `[[${n.title}]]`).join("  ·  ")}`);
  } else if (getExplicitAgentVaultPathFromEnv()) {
    lines.push(sep("Knowledge Vault"));
    lines.push(`Vault: empty — use vault_write() to start building your knowledge base.`);
    lines.push(`Path: ${getAgentVaultRoot()}`);
  }

  const sessionMode = resolveSessionMode(options);
  if (sessionMode) {
    for (const ln of sessionModeLines(sessionMode)) lines.push(ln);
  }

  const handoff = await withDeadline(gatherLongHorizonHandoffLines(workspaceRoot), 800);
  if (handoff && handoff.length > 0) {
    for (const ln of handoff) lines.push(ln);
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  if (options?.notes) lines.push(`\nNotes:  ${options.notes}`);
  lines.push(`\nImportant: Use the date/time above (not training data). Use ${shell} syntax for all shell commands.`);
  lines.push(`Workspace root (agent paths, repo map): ${cwd}`);
  if (processCwd !== workspaceRoot) {
    lines.push(`Process cwd (may differ): ${processCwd}`);
  }
  lines.push(`Relative paths resolve from the workspace root above.`);

  return lines.join("\n");
}
