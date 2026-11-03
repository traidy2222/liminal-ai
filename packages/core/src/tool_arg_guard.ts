/**
 * Pre-execution argument guard (AgentProp-Bench–style propagation mitigation).
 * Runs after JSON schema validation; returns a human-readable block reason or null.
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { isIP } from "node:net";

function internalLiteral(host: string): boolean {
  const ip = host.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(ip) === 6) {
    // URL parsing canonicalizes IPv4-mapped addresses to hexadecimal groups.
    const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mapped) {
      const hi = parseInt(mapped[1]!, 16), lo = parseInt(mapped[2]!, 16);
      return internalLiteral(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return ip === "::" || ip === "::1" || /^(?:f[cd]|fe[89ab]|ff)/i.test(ip);
  }
  return false;
}

const DANGEROUS_SHELL =
  /\brm\s+(-\S+\s+)*\/($|[\s;|&])|rm\s+.*--no-preserve-root|:\(\)\{|\|\s*:\s*&|mkfs\.|dd\s+if=\/dev\/|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|>\s*\/dev\/sd/i;
const DANGEROUS_EXECUTE_CODE =
  /\b(import\s+subprocess|from\s+subprocess\s+import|__import__\s*\(|child_process|require\s*\(\s*["']child_process["']\s*\)|process\.binding\s*\(|Deno\.run\s*\()/i;
const OS_PROCESS_PRIMITIVE = /^(?:system|popen|exec\w*|spawn\w*)$/i;

/** Heuristic process-launch guard, not a Python sandbox or general code parser. */
function hasExecuteCodeProcessPattern(code: string, language: string): boolean {
  if (DANGEROUS_EXECUTE_CODE.test(code)) return true;
  if (language !== "python") return false;

  // Importing os for paths/stat is ordinary file inspection. Guard its process
  // APIs instead, including straightforward module aliases and from-imports.
  const osNames = new Set(["os"]);
  for (const match of code.matchAll(/\bimport\s+([^\n;#]+)/g)) {
    for (const binding of match[1]!.split(",")) {
      if (/^\s*subprocess(?:\s+as\s+\w+)?\s*$/.test(binding)) return true;
      const osBinding = binding.match(/^\s*os(?:\s+as\s+([A-Za-z_]\w*))?\s*$/);
      if (osBinding) osNames.add(osBinding[1] ?? "os");
    }
  }
  for (const match of code.matchAll(/\bfrom\s+os\s+import\s*(?:\(([^)]*)\)|([^\n;#]*))/g)) {
    const imports = match[1] ?? match[2] ?? "";
    for (const binding of imports.split(",")) {
      const name = binding.trim().split(/\s+/)[0] ?? "";
      if (name === "*" || OS_PROCESS_PRIMITIVE.test(name)) return true;
    }
  }
  const processAccess = new RegExp(`\\b(?:${[...osNames].join("|")})\\s*\\.\\s*(system|popen|exec\\w*|spawn\\w*)\\b`, "i");
  return processAccess.test(code);
}

export function guardToolArgs(
  toolName: string,
  args: Record<string, unknown>
): string | null {
  if (toolName === "run_shell" || toolName === "run_background") {
    const cmd = String(args["command"] ?? "");
    if (DANGEROUS_SHELL.test(cmd)) {
      return (
        `Blocked potentially destructive shell pattern. ` +
        `If this is intentional, narrow the command (avoid recursive rm on /, pipe-to-shell downloads, raw dd to devices).`
      );
    }
    if (cmd.length > 200_000) {
      return "Command string exceeds maximum length (200k).";
    }
  }

  if (
    toolName === "write_file" ||
    toolName === "read_file" ||
    toolName === "edit_file"
  ) {
    const path = String(args["path"] ?? "");
    if (!path || path.trim() === "") {
      return "Path must be non-empty.";
    }
    const norm = path.replace(/\\/g, "/").toLowerCase();
    if (
      norm.includes("/etc/shadow") ||
      norm.includes("/etc/sudoers") ||
      norm.endsWith(".ssh/id_rsa") ||
      norm.endsWith(".ssh/id_ed25519")
    ) {
      return "Refusing to read/write sensitive credential paths.";
    }
  }

  if (toolName === "web_fetch") {
    const url = String(args["url"] ?? "");
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return `Unsupported URL scheme: ${u.protocol}`;
      }
      const host = u.hostname.toLowerCase().replace(/\.+$/, "");
      if (
        host === "localhost" ||
        internalLiteral(host) ||
        host.endsWith(".localhost")
      ) {
        return "Blocked fetch to loopback or internal URL (SSRF mitigation).";
      }
    } catch {
      return "Invalid URL for web_fetch.";
    }
  }

  if (toolName === "weather_lookup") {
    const location = String(args["location"] ?? "").trim();
    if (location.length < 2 || location.length > 160) {
      return "weather_lookup location must be 2-160 characters.";
    }
    const hint = args["country_hint"];
    if (hint !== undefined) {
      const c = String(hint).trim();
      if (!/^[A-Za-z]{2}$/.test(c)) return "weather_lookup country_hint must be an ISO-2 code.";
    }
    const units = args["units"];
    if (units !== undefined && units !== "metric" && units !== "imperial") {
      return 'weather_lookup units must be "metric" or "imperial".';
    }
    const preferLive = args["prefer_live"];
    if (preferLive !== undefined && typeof preferLive !== "boolean") {
      return "weather_lookup prefer_live must be boolean when provided.";
    }
  }

  if (toolName === "plan") {
    const steps = args["steps"];
    if (Array.isArray(steps) && steps.length > 40) {
      return "Plan exceeds maximum 40 steps; split into milestones/contracts.";
    }
    const contract = args["contract"];
    if (contract && typeof contract === "object") {
      const c = contract as Record<string, unknown>;
      const maxSteps = Number(c["max_steps"] ?? 0);
      const maxMinutes = Number(c["max_minutes"] ?? 0);
      const maxToolCalls = Number(c["max_tool_calls"] ?? 0);
      if (Number.isFinite(maxSteps) && maxSteps > 200) {
        return "Execution contract max_steps too high (>200).";
      }
      if (Number.isFinite(maxMinutes) && maxMinutes > 10_080) {
        return "Execution contract max_minutes too high (>10080).";
      }
      if (Number.isFinite(maxToolCalls) && maxToolCalls > 2_000) {
        return "Execution contract max_tool_calls too high (>2000).";
      }
    }
  }

  if (toolName === "vault_write") {
    const title = String(args["title"] ?? "").trim();
    const content = String(args["content"] ?? "").trim();
    if (!title) return "vault_write title must be non-empty.";
    if (content.length < 80) {
      return "vault_write content is too short for durable wiki storage (min 80 chars).";
    }
    if (content.length > 120_000) {
      return "vault_write content exceeds max length (120k).";
    }
    if (
      effectiveHarnessEnvRaw("AGENT_VAULT_REQUIRE_LINKS") === "1" &&
      !content.includes("[[")
    ) {
      return "vault_write requires at least one [[Wikilink]] when AGENT_VAULT_REQUIRE_LINKS=1.";
    }
  }

  if (toolName === "execute_code") {
    const language = String(args["language"] ?? "python");
    if (language !== "python" && language !== "javascript") {
      return 'execute_code language must be "python" or "javascript".';
    }
    const code = String(args["code"] ?? "");
    if (code.length < 1) return "execute_code code must be non-empty.";
    if (code.length > 100_000) return "execute_code code exceeds max length (100k).";
    if (hasExecuteCodeProcessPattern(code, language)) {
      return "execute_code blocked a potentially dangerous process-launch or dynamic-import pattern. " +
        "File reads, os.path and os.stat are supported; use run_shell for process orchestration.";
    }
    const timeoutMs = Number(args["timeout_ms"] ?? 30_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      return "execute_code timeout_ms must be between 1 and 120000.";
    }
    const cwdRaw = args["cwd"];
    if (cwdRaw !== undefined) {
      const cwd = String(cwdRaw);
      if (!cwd.trim()) return "execute_code cwd must be non-empty when provided.";
      const normalized = cwd.replace(/\\/g, "/");
      if (normalized.startsWith("/") || normalized.startsWith("..") || normalized.includes("/../")) {
        return "execute_code cwd must stay within workspace-relative paths.";
      }
      if (/^[a-zA-Z]:\//.test(normalized)) {
        return "execute_code cwd must be workspace-relative, not absolute.";
      }
    }
  }

  if (toolName === "markets_quote") {
    const symbolsRaw = args["symbols"];
    if (!Array.isArray(symbolsRaw) || symbolsRaw.length === 0) {
      return "markets_quote symbols must be a non-empty array.";
    }
    if (symbolsRaw.length > 12) {
      return "markets_quote symbols exceeds max batch size (12).";
    }
    for (const s of symbolsRaw) {
      const sym = String(s ?? "").trim();
      if (!sym) return "markets_quote symbol entries must be non-empty strings.";
      if (sym.length > 40) return `markets_quote symbol too long: "${sym.slice(0, 40)}..."`;
      if (!/^[A-Za-z0-9=._\-\/]+$/.test(sym)) {
        return `markets_quote symbol contains unsupported characters: "${sym}"`;
      }
    }
    const asset = args["asset_type"];
    if (
      asset !== undefined &&
      asset !== "auto" &&
      asset !== "equity_etf" &&
      asset !== "fx" &&
      asset !== "commodity" &&
      asset !== "crypto"
    ) {
      return 'markets_quote asset_type must be one of "auto|equity_etf|fx|commodity|crypto".';
    }
  }

  return null;
}
