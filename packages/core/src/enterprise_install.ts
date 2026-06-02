/**
 * Download and install the proprietary @liminal/enterprise package to ~/.liminal/enterprise/.
 * Invoked after `liminal login` for Pro+ tiers and on first harness wire when EE is missing.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LicenseTier } from "./entitlements.js";
import { LICENSE_TIERS } from "./entitlements.js";
import type { ResolvedEntitlements } from "./entitlements.js";
import type { AgentHarness } from "./agent.js";
import type { AgentEmitter } from "./events.js";
import type { ToolRegistry } from "./registry.js";
import { defaultVireonSiteOrigin } from "./vireon_account.js";
import { resolveLicenseTokenForHarness } from "./vireon_account.js";
import {
  enterpriseInstallDir,
  enterpriseManifestPath,
  entrypointForRoot,
  linkEnterpriseHostDependencies,
  loadEnterpriseModule,
} from "./enterprise_loader.js";

export type EnterpriseManifest = {
  version: string;
  sha256: string;
  builtAt: string;
};

export type EnterpriseInstallResult = {
  installed: boolean;
  skipped?: boolean;
  reason?: string;
  version?: string;
  path?: string;
};

function tierRank(tier: LicenseTier): number {
  return LICENSE_TIERS.indexOf(tier);
}

export function tierRequiresEnterprisePackage(tier: LicenseTier): boolean {
  return tierRank(tier) > tierRank("community");
}

function siteOrigin(): string {
  return (process.env["AGENT_VIREON_SITE_URL"]?.trim() || defaultVireonSiteOrigin()).replace(/\/$/, "");
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function extractTarGz(archivePath: string, destDir: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "tar extract failed");
  }
}

async function downloadBundle(token: string): Promise<{ archivePath: string; manifest: EnterpriseManifest }> {
  const url = `${siteOrigin()}/api/enterprise/bundle`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Enterprise bundle download failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const version = res.headers.get("x-enterprise-version") ?? "0.0.0";
  const sha256 = res.headers.get("x-enterprise-sha256") ?? "";
  const builtAt = res.headers.get("x-enterprise-built-at") ?? new Date().toISOString();

  const tmpDir = path.join(enterpriseInstallDir(), ".download");
  await mkdir(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, "enterprise-bundle.tar.gz");
  if (!res.body) throw new Error("Empty bundle response");

  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(archivePath));

  const computed = await sha256File(archivePath);
  if (sha256 && computed !== sha256) {
    throw new Error("Enterprise bundle checksum mismatch");
  }

  return {
    archivePath,
    manifest: { version, sha256: computed || sha256, builtAt },
  };
}

/**
 * Install EE to ~/.liminal/enterprise when the user has a paid license.
 * Idempotent — skips when the same version is already installed.
 */
export async function ensureEnterpriseEditionInstalled(options?: {
  force?: boolean;
  token?: string;
}): Promise<EnterpriseInstallResult> {
  const existing = await loadEnterpriseModule();
  if (existing.ok && !options?.force) {
    return { installed: true, skipped: true, path: existing.source };
  }

  const token = options?.token ?? (await resolveLicenseTokenForHarness());
  if (!token) {
    return { installed: false, reason: "No license token — Community Edition does not require EE" };
  }

  let archivePath = "";
  try {
    const { archivePath: downloaded, manifest } = await downloadBundle(token);

    const priorManifest = await readInstalledManifest();
    if (!options?.force && priorManifest?.version === manifest.version && priorManifest.sha256 === manifest.sha256) {
      const entry = entrypointForRoot(enterpriseInstallDir());
      if (existsSync(entry)) {
        return { installed: true, skipped: true, version: manifest.version, path: enterpriseInstallDir() };
      }
    }

    archivePath = downloaded;
    const dest = enterpriseInstallDir();
    const staging = `${dest}.staging`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    extractTarGz(archivePath, staging);

    await rm(dest, { recursive: true, force: true });
    await mkdir(path.dirname(dest), { recursive: true });
    const { rename } = await import("node:fs/promises");
    await rename(staging, dest);
    await linkEnterpriseHostDependencies(dest);
    await writeFile(enterpriseManifestPath(), JSON.stringify(manifest, null, 2), "utf8");

    return { installed: true, version: manifest.version, path: dest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { installed: false, reason: message };
  } finally {
    if (archivePath) {
      await rm(path.dirname(archivePath), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function readInstalledManifest(): Promise<EnterpriseManifest | null> {
  try {
    const raw = await readFile(enterpriseManifestPath(), "utf8");
    return JSON.parse(raw) as EnterpriseManifest;
  } catch {
    return null;
  }
}

/** Try to install EE when missing, then wire Pro+ tools. Never throws. */
export async function wireEnterpriseWithInstall(input: {
  registry: ToolRegistry;
  emitter: AgentEmitter;
  harness: AgentHarness;
  entitlements?: ResolvedEntitlements;
  autoActivate?: boolean;
}): Promise<import("./enterprise_loader.js").WireEnterpriseEditionResult> {
  const { loadHarnessEntitlements } = await import("./vireon_account.js");
  const { wireEnterpriseEdition } = await import("./enterprise_loader.js");
  const entitlements = input.entitlements ?? (await loadHarnessEntitlements());

  let result = await wireEnterpriseEdition({ ...input, entitlements });
  if (!result.wired && tierRequiresEnterprisePackage(entitlements.tier)) {
    await ensureEnterpriseEditionInstalled().catch(() => undefined);
    result = await wireEnterpriseEdition({ ...input, entitlements });
  }
  return result;
}
