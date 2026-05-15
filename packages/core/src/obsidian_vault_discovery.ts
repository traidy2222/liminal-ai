/**
 * Best-effort discovery of an Obsidian vault folder from Obsidian's global `obsidian.json`
 * (registered vault list). No network; read-only local file.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, normalize } from "node:path";

export type ObsidianVaultPickOptions = {
  /** When true, require `<path>/.obsidian` to exist (reduces false positives). */
  requireDotObsidian: boolean;
  /** If set, only vaults whose path contains this substring (case-insensitive) are considered. */
  nameSubstring?: string;
};

export interface ObsidianVaultEntry {
  id: string;
  path: string;
  ts?: number;
  open?: boolean;
}

/** OS-specific candidate paths for Obsidian's global config (first existing wins). */
export function candidateObsidianJsonPaths(): string[] {
  const out: string[] = [];
  if (platform() === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) out.push(join(appData, "Obsidian", "obsidian.json"));
  } else if (platform() === "darwin") {
    out.push(join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json"));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME?.trim();
    if (xdg) out.push(join(xdg, "obsidian", "obsidian.json"));
    out.push(join(homedir(), ".config", "obsidian", "obsidian.json"));
  }
  return out;
}

function extractVaultEntries(parsed: unknown): ObsidianVaultEntry[] {
  if (!parsed || typeof parsed !== "object") return [];
  const vaults = (parsed as { vaults?: unknown }).vaults;
  if (!vaults || typeof vaults !== "object" || Array.isArray(vaults)) return [];
  const out: ObsidianVaultEntry[] = [];
  for (const [id, raw] of Object.entries(vaults as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as { path?: unknown; ts?: unknown; open?: unknown };
    const path = typeof o.path === "string" ? o.path.trim() : "";
    if (!path) continue;
    const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : undefined;
    const open = o.open === true;
    out.push({ id, path, ts, open });
  }
  return out;
}

/**
 * Pick at most one vault path from parsed `obsidian.json` using ambiguity rules
 * (no filesystem checks).
 */
export function pickObsidianVaultFromParsedConfig(
  parsed: unknown,
  opts: ObsidianVaultPickOptions
): string | undefined {
  let entries = extractVaultEntries(parsed);
  if (entries.length === 0) return undefined;

  const sub = opts.nameSubstring?.trim();
  if (sub) {
    const low = sub.toLowerCase();
    entries = entries.filter((e) => e.path.toLowerCase().includes(low));
    if (entries.length === 0) return undefined;
  }

  if (entries.length === 1) return normalize(entries[0]!.path);

  const opened = entries.filter((e) => e.open === true);
  if (opened.length === 1) return normalize(opened[0]!.path);

  const withTs = entries.filter((e) => e.ts != null && Number.isFinite(e.ts));
  if (withTs.length >= 2) {
    const sorted = [...withTs].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const top = sorted[0]!;
    const second = sorted[1]!;
    if ((top.ts ?? 0) > (second.ts ?? 0)) return normalize(top.path);
  }

  return undefined;
}

export function validateVaultDirectory(path: string, requireDotObsidian: boolean): boolean {
  try {
    const st = statSync(path, { throwIfNoEntry: false });
    if (!st?.isDirectory()) return false;
    if (!requireDotObsidian) return true;
    return existsSync(join(path, ".obsidian"));
  } catch {
    return false;
  }
}

/**
 * Read Obsidian global config from disk and return a single vault path when unambiguous.
 * Returns `undefined` if no config, parse failure, ambiguous multi-vault, or validation fails.
 */
export function discoverObsidianVaultPathFromAppData(opts: ObsidianVaultPickOptions): string | undefined {
  for (const jsonPath of candidateObsidianJsonPaths()) {
    if (!existsSync(jsonPath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
    } catch {
      continue;
    }
    const picked = pickObsidianVaultFromParsedConfig(parsed, opts);
    if (!picked) continue;
    if (validateVaultDirectory(picked, opts.requireDotObsidian)) return picked;
  }
  return undefined;
}
