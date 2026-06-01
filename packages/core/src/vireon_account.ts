/**
 * Local Vireon account binding — license + profile persisted under ~/.liminal/
 * (not .env). Use {@link runVireonConnectFlow} or the web Settings "Sign in" flow.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRoot, globalPath } from "./global_storage.js";
import {
  ENTITLEMENTS,
  hasEntitlement,
  loadResolvedEntitlements,
  resolveEntitlements,
  writeCachedLicenseToken,
  readCachedLicenseToken,
  type ResolvedEntitlements,
} from "./entitlements.js";
import {
  loadRuntimePreferences,
  saveRuntimePreferences,
  type RuntimePreferences,
} from "./runtime_prefs.js";

const ACCOUNT_FILE = "account.json";

export interface VireonAccountRecord {
  version: 1;
  email: string;
  tier: string;
  licenseSub?: string;
  connectedAt: number;
  /** Last successful connect method */
  source: "browser" | "paste" | "env";
}

export function vireonAccountPath(): string {
  return globalPath(ACCOUNT_FILE);
}

export async function readVireonAccount(): Promise<VireonAccountRecord | null> {
  try {
    const raw = await readFile(vireonAccountPath(), "utf8");
    const rec = JSON.parse(raw) as VireonAccountRecord;
    if (rec?.version !== 1 || typeof rec.email !== "string") return null;
    return rec;
  } catch {
    return null;
  }
}

export async function writeVireonAccount(
  partial: Omit<VireonAccountRecord, "version" | "connectedAt"> & { connectedAt?: number }
): Promise<VireonAccountRecord> {
  await ensureGlobalStorageRoot();
  const rec: VireonAccountRecord = {
    version: 1,
    connectedAt: partial.connectedAt ?? Date.now(),
    email: partial.email,
    tier: partial.tier,
    ...(partial.licenseSub ? { licenseSub: partial.licenseSub } : {}),
    source: partial.source,
  };
  const p = vireonAccountPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(rec, null, 2), "utf8");
  return rec;
}

/** Validate license JWT and persist to ~/.liminal/license.json + account.json */
export async function applyVireonLicenseToken(
  token: string,
  meta: { email: string; source: VireonAccountRecord["source"]; licenseSub?: string }
): Promise<ResolvedEntitlements> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Empty license token");
  const resolved = resolveEntitlements({ token: trimmed });
  if (!resolved.license) {
    throw new Error(resolved.reason ?? "License token is not valid");
  }
  await writeCachedLicenseToken(trimmed);
  await writeVireonAccount({
    email: meta.email,
    tier: resolved.tier,
    licenseSub: meta.licenseSub,
    source: meta.source,
  });
  if (hasEntitlement(resolved, ENTITLEMENTS.PRO_MANAGED_INFERENCE)) {
    await applyProManagedInferenceDefaults();
  }
  return resolved;
}

/** After Pro sign-in, default harness routing to Vireon managed inference (overridable in Settings). */
export async function applyProManagedInferenceDefaults(): Promise<void> {
  const patch = {
    provider: { inferenceMode: "managed" as const },
    harness: {
      env: { AGENT_INFERENCE_MODE: "managed", AGENT_INFERENCE_PREFER_MANAGED: "1" },
    },
  };
  const existing =
    (await loadRuntimePreferences()) ??
    ({ version: 1, updatedAt: Date.now() } satisfies RuntimePreferences);
  const merged: RuntimePreferences = {
    ...existing,
    updatedAt: Date.now(),
    provider: { ...existing.provider, ...patch.provider },
    harness: {
      env: { ...existing.harness?.env, ...patch.harness?.env },
    },
  };
  await saveRuntimePreferences(merged);
}

export async function clearVireonAccount(): Promise<void> {
  const { clearManagedInferenceSessionCache } = await import("./inference_session.js");
  clearManagedInferenceSessionCache();
  await ensureGlobalStorageRoot();
  const { unlink } = await import("node:fs/promises");
  for (const p of [vireonAccountPath(), globalPath("license.json")]) {
    try {
      await unlink(p);
    } catch {
      /* ignore */
    }
  }
}

/** Preferred license token: disk cache from connect, then optional env override for CI. */
export async function resolveLicenseTokenForHarness(): Promise<string | null> {
  const cached = await readCachedLicenseToken();
  const env = (process.env["AGENT_LICENSE_KEY"] ?? "").trim();
  if (process.env["AGENT_LICENSE_PREFER_ENV"] === "1") {
    return env || cached;
  }
  return cached || env || null;
}

export async function loadHarnessEntitlements(): Promise<ResolvedEntitlements> {
  const token = await resolveLicenseTokenForHarness();
  if (!token) return loadResolvedEntitlements({ token: "" });
  return loadResolvedEntitlements({ token });
}

export function defaultVireonSiteOrigin(): string {
  const raw =
    process.env["AGENT_VIREON_SITE_URL"]?.trim() ||
    process.env["VIREON_SITE_URL"]?.trim() ||
    "https://www.vireondynamics.com";
  return raw.replace(/\/$/, "");
}
