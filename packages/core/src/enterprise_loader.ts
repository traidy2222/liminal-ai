/**
 * Optional Enterprise Edition (EE) loader — keeps proprietary code out of the FSL repo.
 *
 * Resolution order:
 *  1. AGENT_ENTERPRISE_DIR — absolute path to an EE package root (dist/ + package.json)
 *  2. ~/.liminal/enterprise/ — installed by `liminal login` or ensureEnterpriseEditionInstalled()
 *  3. packages/enterprise/ under the workspace (local dev; gitignored in public clones)
 *  4. @liminal/enterprise npm workspace link (monorepo dev when present)
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { access, mkdir, symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { AgentHarness } from "./agent.js";
import type { AgentEmitter } from "./events.js";
import type { ToolRegistry } from "./registry.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { globalPath } from "./global_storage.js";
import type { ResolvedEntitlements } from "./entitlements.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const ENTERPRISE_DIR_NAME = "enterprise";

export type EnterpriseWireResult = {
  registered: string[];
  activatedFamilies: string[];
  skipped: Array<{ id: string; reason: string }>;
};

export type EnterpriseModule = {
  wireEnterpriseHarness: (input: {
    registry: ToolRegistry;
    emitter: AgentEmitter;
    harness: AgentHarness;
    entitlements?: ResolvedEntitlements;
    autoActivate?: boolean;
  }) => Promise<EnterpriseWireResult>;
};

export type EnterpriseLoadResult =
  | { ok: true; module: EnterpriseModule; source: string }
  | { ok: false; reason: string };

export type WireEnterpriseEditionResult =
  | ({ wired: true } & EnterpriseWireResult & { source: string })
  | { wired: false; reason: string };

function enterpriseGlobalDir(): string {
  return globalPath(ENTERPRISE_DIR_NAME);
}

function workspaceEnterpriseDir(): string {
  return path.join(resolveWorkspaceRoot(), "packages", "enterprise");
}

/** Candidate EE package roots (existing dirs with dist/index.js). */
export function resolveEnterpriseRoots(): string[] {
  const roots: string[] = [];
  const envDir = effectiveHarnessEnvRaw("AGENT_ENTERPRISE_DIR")?.trim();
  if (envDir) roots.push(path.resolve(envDir));
  roots.push(enterpriseGlobalDir());
  roots.push(workspaceEnterpriseDir());
  return roots;
}

export function entrypointForRoot(root: string): string {
  return path.join(root, "dist", "index.js");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isLink(p: string): Promise<boolean> {
  try {
    const st = await lstat(p);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Symlink host @liminal/core and @liminal/tools so EE dist can import them. */
export async function linkEnterpriseHostDependencies(enterpriseRoot: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const hostCore = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const toolsEntry = require.resolve("@liminal/tools");
  const hostTools = path.join(path.dirname(toolsEntry), "..");
  const scopeDir = path.join(enterpriseRoot, "node_modules", "@liminal");
  await mkdir(scopeDir, { recursive: true });

  const links: Array<[string, string]> = [
    [path.join(scopeDir, "core"), hostCore],
    [path.join(scopeDir, "tools"), hostTools],
  ];

  for (const [linkPath, target] of links) {
    if (await pathExists(linkPath)) {
      if (!(await isLink(linkPath))) continue;
    }
    try {
      await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      /* already linked or platform limitation — best effort */
    }
  }
}

export async function loadEnterpriseModule(): Promise<EnterpriseLoadResult> {
  let lastError: string | undefined;
  for (const root of resolveEnterpriseRoots()) {
    const entry = entrypointForRoot(root);
    if (!existsSync(entry)) continue;
    try {
      await linkEnterpriseHostDependencies(root);
      const mod = (await import(pathToFileURL(entry).href)) as EnterpriseModule;
      if (typeof mod.wireEnterpriseHarness !== "function") {
        return { ok: false, reason: `Enterprise module at ${entry} missing wireEnterpriseHarness export` };
      }
      return { ok: true, module: mod, source: root };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Try next candidate root (e.g. corrupt ~/.liminal/enterprise vs valid workspace checkout).
      lastError = `Failed to load enterprise from ${root}: ${message}`;
      continue;
    }
  }

  if (lastError) {
    return { ok: false, reason: lastError };
  }

  try {
    const mod = (await import("@liminal/enterprise")) as EnterpriseModule;
    if (typeof mod.wireEnterpriseHarness === "function") {
      return { ok: true, module: mod, source: "@liminal/enterprise" };
    }
  } catch {
    /* optional workspace package not installed */
  }

  return {
    ok: false,
    reason:
      "Enterprise Edition not installed. Pro+ users: run `liminal login` to download EE, or set AGENT_ENTERPRISE_DIR.",
  };
}

export function enterpriseInstallDir(): string {
  return enterpriseGlobalDir();
}

export function enterpriseManifestPath(): string {
  return path.join(enterpriseGlobalDir(), "manifest.json");
}

/** Wire EE tools when the proprietary package is available. Never throws. */
export async function wireEnterpriseEdition(input: {
  registry: ToolRegistry;
  emitter: AgentEmitter;
  harness: AgentHarness;
  entitlements?: ResolvedEntitlements;
  autoActivate?: boolean;
}): Promise<WireEnterpriseEditionResult> {
  const loaded = await loadEnterpriseModule();
  if (!loaded.ok) {
    return { wired: false, reason: loaded.reason };
  }
  try {
    const result = await loaded.module.wireEnterpriseHarness(input);
    return { wired: true, ...result, source: loaded.source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { wired: false, reason: message };
  }
}
