/**
 * Validates multi-part file creation (write_file create + append) without a single giant tool arg.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import type { Scenario } from "../runner.js";
import { traceToolResults, traceToolRanOk } from "../runner.js";

const TWO_PART_REL = ".agent_artifacts/eval-two-part.txt";

function twoPartFileOnDisk(): string | null {
  const abs = join(resolveWorkspaceRoot(), TWO_PART_REL);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export const largeFileWriteTwoPart: Scenario = {
  name: "large-file-write-two-part",
  userMessage:
    "You MUST call write_file exactly twice (no run_shell). " +
    `Create \`${TWO_PART_REL}\` with two lines:\n` +
    "1) write_file mode=create content `PART_A\\n`\n" +
    "2) write_file mode=append content `PART_B\\n`\n" +
    "Do not reply until both tool calls returned ok.",
  maxRounds: 12,
  timeoutMs: 90_000,
  tags: ["files"],
  assertions: [
    {
      name: "write_file create then append in order",
      check: (t) => {
        const ok = traceToolResults(t, "write_file").filter((r) => r.result.ok);
        if (ok.length < 2) return false;
        const m0 = String(ok[0]!.args["mode"] ?? "create");
        const m1 = String(ok[1]!.args["mode"] ?? "create");
        return m0 === "create" && m1 === "append";
      },
    },
    {
      name: "both write_file calls succeeded",
      check: (t) => {
        const ok = t.filter(
          (e) =>
            e.type === "tool_result" &&
            (e.payload as { name?: string; result?: { ok?: boolean } }).name === "write_file" &&
            (e.payload as { result?: { ok?: boolean } }).result?.ok
        );
        return ok.length >= 2;
      },
    },
    {
      name: "file on disk has PART_A and PART_B",
      check: () => {
        const body = twoPartFileOnDisk();
        return body !== null && body.includes("PART_A") && body.includes("PART_B");
      },
    },
  ],
};

/** Single write_file: small working JS module on disk. */
export const writeFileCodeSmoke: Scenario = {
  name: "write-file-code-smoke",
  userMessage:
    "Use write_file only (no shell). Create `.agent_artifacts/eval-hello.js` with exactly this one line:\n" +
    "export function add(a, b) { return a + b; }\n" +
    "Reply DONE only after write_file succeeds.",
  maxRounds: 8,
  timeoutMs: 60_000,
  tags: ["files", "smoke"],
  assertions: [
    {
      name: "write_file succeeded",
      check: (t) => traceToolRanOk(t, "write_file"),
    },
    {
      name: "eval-hello.js exports add()",
      check: () => {
        const abs = join(resolveWorkspaceRoot(), ".agent_artifacts/eval-hello.js");
        if (!existsSync(abs)) return false;
        const body = readFileSync(abs, "utf8");
        return /export\s+function\s+add\s*\(/.test(body) && body.includes("return a + b");
      },
    },
  ],
};

export const LARGE_FILE_WRITE_SCENARIOS = [largeFileWriteTwoPart, writeFileCodeSmoke];
