/**
 * Encrypted OAuth token storage under ~/.liminal/oauth/<provider>/<accountId>.json
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { globalPath } from "./global_storage.js";

const OAUTH_DIR_SEG = "oauth";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;

export interface OAuthTokenBundle {
  provider: string;
  accountId: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  /** Provider-specific payload (e.g. Xero tenantId / tenant list). */
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

function oauthRoot(): string {
  return globalPath(OAUTH_DIR_SEG);
}

function providerDir(provider: string): string {
  return path.join(oauthRoot(), provider.replace(/[^a-z0-9_-]/gi, "_"));
}

function accountPath(provider: string, accountId: string): string {
  return path.join(providerDir(provider), `${accountId.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function deriveKey(): Buffer {
  const secret =
    process.env.AGENT_OAUTH_ENCRYPTION_KEY?.trim() ||
    process.env.AGENT_API_KEY?.trim()?.slice(0, 32) ||
    `${process.env.USERNAME ?? "liminal"}@${process.env.COMPUTERNAME ?? "local"}`;
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("corrupt oauth blob");
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function ensureProviderDir(provider: string): Promise<string> {
  const dir = providerDir(provider);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function sanitizeOAuthAccountId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_").slice(0, 80);
  return s || "default";
}

export async function writeOAuthBundle(bundle: OAuthTokenBundle): Promise<void> {
  await ensureProviderDir(bundle.provider);
  const payload = encrypt(JSON.stringify(bundle));
  await writeFile(accountPath(bundle.provider, bundle.accountId), payload, "utf8");
}

export async function readOAuthBundle(
  provider: string,
  accountId?: string
): Promise<OAuthTokenBundle | null> {
  ensureDirSync(provider);
  if (accountId) {
    try {
      const raw = await readFile(accountPath(provider, accountId), "utf8");
      return JSON.parse(decrypt(raw)) as OAuthTokenBundle;
    } catch {
      return null;
    }
  }
  const all = await listOAuthAccounts(provider);
  return all[0] ?? null;
}

function ensureDirSync(provider: string): void {
  const root = oauthRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const dir = providerDir(provider);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function listOAuthAccounts(provider: string): Promise<OAuthTokenBundle[]> {
  ensureDirSync(provider);
  const dir = providerDir(provider);
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: OAuthTokenBundle[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, f), "utf8");
      out.push(JSON.parse(decrypt(raw)) as OAuthTokenBundle);
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function deleteOAuthBundle(provider: string, accountId: string): Promise<boolean> {
  try {
    await unlink(accountPath(provider, accountId));
    return true;
  } catch {
    return false;
  }
}
