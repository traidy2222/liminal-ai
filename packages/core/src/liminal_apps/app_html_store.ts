import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRoot, globalPath } from "../global_storage.js";
import { effectiveHarnessEnvRaw } from "../harness_effective_env.js";
import type { LiminalAppSpec } from "./app_spec.js";
import { repairWidgetHtmlDocument } from "./widget_html_merge.js";

const HTML_SUBDIR = "apps/html";

export function appHtmlMaxBytes(): number {
  const raw = Number(effectiveHarnessEnvRaw("AGENT_APP_HTML_MAX_BYTES") ?? "409600");
  return Number.isFinite(raw) ? Math.max(4096, Math.min(2_000_000, raw)) : 409_600;
}

function htmlDir(): string {
  return path.join(globalPath("apps"), "html");
}

export function appHtmlPath(appId: string): string {
  const safe = appId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 48);
  return path.join(htmlDir(), `${safe}.html`);
}

export async function writeAppHtml(appId: string, html: string): Promise<string> {
  const max = appHtmlMaxBytes();
  if (Buffer.byteLength(html, "utf8") > max) {
    throw new Error(`HTML exceeds AGENT_APP_HTML_MAX_BYTES (${max}).`);
  }
  await ensureGlobalStorageRoot();
  await mkdir(htmlDir(), { recursive: true });
  const filePath = appHtmlPath(appId);
  await writeFile(filePath, html, "utf8");
  return filePath;
}

export async function readAppHtml(appId: string): Promise<string | null> {
  try {
    const raw = await readFile(appHtmlPath(appId), "utf8");
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function removeAppHtml(appId: string): Promise<void> {
  await unlink(appHtmlPath(appId)).catch(() => undefined);
}

/** Read persisted widget HTML for an app spec (inline or html_ref). */
export async function resolveStoredAppHtml(spec: LiminalAppSpec): Promise<string> {
  let body = "";
  if (spec.props["html_ref"] === true) {
    body = (await readAppHtml(spec.id)) ?? "";
  } else {
    body = String(spec.props["html"] ?? "");
  }
  return repairWidgetHtmlDocument(body);
}
