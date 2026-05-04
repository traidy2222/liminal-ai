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

  return null;
}
