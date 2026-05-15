/**
 * Tool-output distillation: large reads → structured summary + artifact pointer.
 */
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface DistilledOutput {
  source: { tool: string; arg: string; hash: string };
  claims: string[];
  paths_or_urls: string[];
  unknowns: string[];
  next_actions: string[];
  full_text_pointer: string;
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < Math.min(s.length, 50_000); i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function artifactPathForHash(hash: string): string {
  return path.join(resolveWorkspaceRoot(), ".agent_artifacts", `${hash}.txt`);
}

/** Refuse to load whole artifact files larger than this (read_artifact / distill pointers). */
export const MAX_ARTIFACT_BYTES = 12_000_000;

const MAX_ARTIFACT_LINES_PER_READ = 8_000;

export async function writeArtifact(hash: string, fullText: string): Promise<string> {
  const dir = path.join(resolveWorkspaceRoot(), ".agent_artifacts");
  await mkdir(dir, { recursive: true });
  const p = artifactPathForHash(hash);
  await writeFile(p, fullText, "utf8");
  return p;
}

/** Persist a large tool body for elision; returns stable hash + on-disk pointer path. */
export async function stashToolBodyElide(content: string): Promise<{ hash: string; pointer: string }> {
  const hash = shortHash(content);
  const pointer = await writeArtifact(hash, content);
  return { hash, pointer };
}

export async function readArtifactText(
  hash: string,
  range?: { startLine: number; endLine: number }
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const clean = hash.replace(/[^a-f0-9]/gi, "");
  if (!clean) {
    return { ok: false, error: "read_artifact: invalid hash" };
  }
  try {
    const p = artifactPathForHash(clean);
    const st = await stat(p);
    if (st.size > MAX_ARTIFACT_BYTES) {
      return {
        ok: false,
        error:
          `Artifact too large (${st.size} bytes, max ${MAX_ARTIFACT_BYTES}). ` +
          "Use start_line/end_line for a slice or re-fetch with a smaller web_fetch max_chars.",
      };
    }
    const raw = await readFile(p, "utf8");
    if (!range) return { ok: true, text: raw };
    const start = Math.max(1, range.startLine);
    let end = range.endLine <= 0 ? start + MAX_ARTIFACT_LINES_PER_READ - 1 : range.endLine;
    if (end - start + 1 > MAX_ARTIFACT_LINES_PER_READ) {
      end = start + MAX_ARTIFACT_LINES_PER_READ - 1;
    }
    const lines = raw.split("\n");
    const slice = lines.slice(start - 1, end);
    const text = slice.join("\n");
    const truncated = end < lines.length ? `\n[artifact truncated to lines ${start}-${end}]` : "";
    return { ok: true, text: text + truncated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/enoent|not found/i.test(msg)) {
      return {
        ok: false,
        error:
          `Artifact not found for hash "${clean}". ` +
          "Artifacts exist only when AGENT_DISTILL=1 or AGENT_TOOL_BODY_ELIDE=1 stored tool output — use the inline summary or call web_fetch again.",
      };
    }
    return { ok: false, error: msg };
  }
}

export function shouldDistillToolOutput(toolName: string, output: string): boolean {
  if (effectiveHarnessEnvRaw("AGENT_DISTILL") !== "1") return false;
  if (!output || output.startsWith("ERROR:")) return false;
  if (toolName === "read_file" && output.length > 2000) return true;
  if (toolName === "web_fetch" && output.length > 1500) return true;
  if (toolName === "run_shell" && output.split("\n").length > 100) return true;
  if (toolName === "recall_relevant" && output.length > 2500) return true;
  return false;
}

export async function distillToolOutput(
  client: OpenAI,
  defaultModel: string,
  toolName: string,
  argsJson: string,
  output: string
): Promise<{ display: string; distilled: DistilledOutput }> {
  const hash = shortHash(`${toolName}:${argsJson}:${output.slice(0, 8000)}`);
  await writeArtifact(hash, output);
  const pointer = artifactPathForHash(hash);
  const fast = getFastModelSlug(defaultModel);
  const sys =
    "Extract a compact JSON summary of the tool output. No prose outside JSON.\n" +
    'Schema: {"claims": string[], "paths_or_urls": string[], "unknowns": string[], "next_actions": string[]}\n' +
    "claims: factual bullets supported by the text. paths_or_urls: file paths or URLs mentioned.";
  const r = await completeChatJson(client, {
    model: fast,
    messages: [
      { role: "system", content: sys },
      {
        role: "user",
        content:
          `TOOL: ${toolName}\nARGS: ${argsJson.slice(0, 1200)}\n\nOUTPUT (truncated):\n${output.slice(0, 12_000)}`,
      },
    ],
    maxTokens: 700,
    temperature: 0.1,
  });
  let claims: string[] = [];
  let paths_or_urls: string[] = [];
  let unknowns: string[] = [];
  let next_actions: string[] = [];
  if (r.ok && typeof r.parsed === "object" && r.parsed !== null) {
    const o = r.parsed as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((y) => String(y).trim()).filter(Boolean) : []);
    claims = arr(o["claims"]).slice(0, 20);
    paths_or_urls = arr(o["paths_or_urls"]).slice(0, 20);
    unknowns = arr(o["unknowns"]).slice(0, 12);
    next_actions = arr(o["next_actions"]).slice(0, 12);
  }
  if (claims.length === 0) {
    claims = [output.slice(0, 200).replace(/\s+/g, " ") + (output.length > 200 ? "…" : "")];
  }
  const distilled: DistilledOutput = {
    source: { tool: toolName, arg: argsJson.slice(0, 400), hash },
    claims,
    paths_or_urls,
    unknowns,
    next_actions,
    full_text_pointer: pointer,
  };
  const nextActionsJson = JSON.stringify({
    read_artifact: { hash },
  });
  const display =
    `[DISTILLED OUTPUT — full text archived at hash=${hash}]\n` +
    `claims:\n${claims.map((c) => `  - ${c}`).join("\n")}\n` +
    `paths_or_urls:\n${paths_or_urls.map((p) => `  - ${p}`).join("\n") || "  (none)"}\n` +
    `unknowns:\n${unknowns.map((u) => `  - ${u}`).join("\n") || "  (none)"}\n` +
    `next_actions:\n${next_actions.map((a) => `  - ${a}`).join("\n") || "  (none)"}\n` +
    `read_artifact({ "hash": "${hash}" }) to retrieve full text.\n` +
    `NEXT_ACTIONS_JSON: ${nextActionsJson}`;
  return { display, distilled };
}
