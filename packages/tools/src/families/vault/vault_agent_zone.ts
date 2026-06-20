/**
 * Agent-managed vault zone — safe edits in mixed personal Obsidian vaults.
 */
import { join } from "node:path";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { getVaultDir, type VaultNote } from "./vault_store.js";

export const LIMINAL_AGENT_TAG = "liminal-agent";

/** Default subfolder prefix for agent-owned spine/raw/archive (env override). */
export function resolveVaultAgentPrefix(): string {
  const raw = effectiveHarnessEnvRaw("AGENT_VAULT_AGENT_PREFIX")?.trim();
  return raw || "_liminal";
}

export function agentZoneRoot(): string {
  const prefix = resolveVaultAgentPrefix().replace(/^\/+|\/+$/g, "");
  return prefix ? join(getVaultDir(), prefix) : getVaultDir();
}

export function isPathInAgentZone(filePath: string): boolean {
  const prefix = resolveVaultAgentPrefix().replace(/^\/+|\/+$/g, "");
  if (!prefix) return false;
  const zone = join(getVaultDir(), prefix).toLowerCase();
  return filePath.toLowerCase().startsWith(zone);
}

export function noteHasAgentTag(note: Pick<VaultNote, "tags">): boolean {
  return note.tags.some((t) => t.toLowerCase() === LIMINAL_AGENT_TAG);
}

/** Heuristic for backfill: notes the harness likely created before liminal-agent tag existed. */
export function isHeuristicAgentNote(note: Pick<VaultNote, "tags" | "title" | "body">): boolean {
  if (noteHasAgentTag(note)) return true;
  const tags = note.tags.map((t) => t.toLowerCase());
  if (tags.includes("auto-wiki") || tags.includes("harness") || tags.includes("hub")) return true;
  if (/^Knowledge \d{4}-\d{2}-\d{2}/i.test(note.title)) return true;
  if (tags.includes("entity") && /##\s+Identity/i.test(note.body)) return true;
  return false;
}

export function isAgentManagedNote(note: Pick<VaultNote, "tags" | "title" | "body" | "filePath">): boolean {
  return isPathInAgentZone(note.filePath) || isHeuristicAgentNote(note);
}

/** Whether the harness may auto-edit this note's body (lint fix, bidirectional weave inbound). */
export function canAutoEditNote(note: Pick<VaultNote, "tags" | "title" | "body" | "filePath">): boolean {
  return isAgentManagedNote(note);
}

export function ensureAgentTags(tags: string[] | undefined): string[] {
  const base = [...(tags ?? [])];
  if (!base.some((t) => t.toLowerCase() === LIMINAL_AGENT_TAG)) {
    base.push(LIMINAL_AGENT_TAG);
  }
  return base;
}
