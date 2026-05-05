/**
 * Pre-execution argument guard (AgentProp-Bench–style propagation mitigation).
 * Runs after JSON schema validation; returns a human-readable block reason or null.
 */
const DANGEROUS_SHELL =
  /\brm\s+(-\S+\s+)*\/($|[\s;|&])|rm\s+.*--no-preserve-root|:\(\)\{|\|\s*:\s*&|mkfs\.|dd\s+if=\/dev\/|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|>\s*\/dev\/sd/i;

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

  if (toolName === "write_file" || toolName === "read_file") {
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
      const host = u.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".localhost")
      ) {
        return "Blocked fetch to loopback URL (SSRF mitigation).";
      }
    } catch {
      return "Invalid URL for web_fetch.";
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
      process.env["AGENT_VAULT_REQUIRE_LINKS"] === "1" &&
      !content.includes("[[")
    ) {
      return "vault_write requires at least one [[Wikilink]] when AGENT_VAULT_REQUIRE_LINKS=1.";
    }
  }

  return null;
}
