/**
 * Encrypted OAuth token storage under ~/.liminal/oauth/<provider>/<accountId>.json
 *
 * Encryption uses a stable per-machine device key (~/.liminal/oauth/.encryption_key)
 * so tokens survive app restarts without depending on AGENT_API_KEY being loaded.
 * Legacy blobs encrypted with API-key or machine-id material are migrated on read.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalPath } from "./global_storage.js";
import { loadHarnessEnvFiles } from "./load_harness_env.js";
import { ensureProviderApiKeysInProcess, legacyOAuthKeyMaterial } from "./provider_api_key.js";

const OAUTH_DIR_SEG = "oauth";
const DEVICE_KEY_FILE = ".encryption_key";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;

let oauthEnvPrimed = false;

/** @internal test hook */
export function __resetOAuthStoreEnvPrimedForTests(): void {
  oauthEnvPrimed = false;
}

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

/** Ensure `.env` / provider keys are loaded before encrypt/decrypt (desktop bundle). */
export function ensureOAuthSecretsLoaded(): void {
  if (oauthEnvPrimed) return;
  oauthEnvPrimed = true;
  loadHarnessEnvFiles({
    repoRoot: process.env["LIMINAL_REPO_ROOT"],
    cwd: process.cwd(),
  });
  ensureProviderApiKeysInProcess();
}

function oauthRoot(): string {
  return globalPath(OAUTH_DIR_SEG);
}

function deviceKeyPath(): string {
  return path.join(oauthRoot(), DEVICE_KEY_FILE);
}

function providerDir(provider: string): string {
  return path.join(oauthRoot(), provider.replace(/[^a-z0-9_-]/gi, "_"));
}

function accountPath(provider: string, accountId: string): string {
  return path.join(providerDir(provider), `${accountId.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function hashKeyMaterial(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

function ensureOAuthRootSync(): void {
  const root = oauthRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
}

function readDeviceKeySync(): Buffer | null {
  try {
    const raw = readFileSync(deviceKeyPath(), "utf8").trim();
    const buf = Buffer.from(raw, "base64url");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

function ensureDeviceKeySync(): Buffer {
  const existing = readDeviceKeySync();
  if (existing) return existing;
  ensureOAuthRootSync();
  const key = randomBytes(32);
  writeFileSync(deviceKeyPath(), key.toString("base64url"), { mode: 0o600 });
  return key;
}

/** Key used for new writes and first decrypt attempt. */
function primaryEncryptionKey(): Buffer {
  const explicit = process.env.AGENT_OAUTH_ENCRYPTION_KEY?.trim();
  if (explicit) return hashKeyMaterial(explicit);
  return ensureDeviceKeySync();
}

function encryptionKeyCandidates(): Buffer[] {
  ensureOAuthSecretsLoaded();
  const seen = new Set<string>();
  const keys: Buffer[] = [];
  const push = (buf: Buffer): void => {
    const id = buf.toString("hex");
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(buf);
  };
  push(primaryEncryptionKey());
  for (const material of legacyOAuthKeyMaterial()) {
    push(hashKeyMaterial(material));
  }
  return keys;
}

function decryptWithKey(payload: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("corrupt oauth blob");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptWithKey(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

function decryptPayload(payload: string): { json: string; key: Buffer } | null {
  for (const key of encryptionKeyCandidates()) {
    try {
      return { json: decryptWithKey(payload, key), key };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function encrypt(plain: string): string {
  ensureOAuthSecretsLoaded();
  return encryptWithKey(plain, primaryEncryptionKey());
}

async function maybeMigrateEncryptedFile(
  provider: string,
  accountId: string,
  payload: string,
  usedKey: Buffer
): Promise<void> {
  const primary = primaryEncryptionKey();
  if (usedKey.equals(primary)) return;
  try {
    const reparsed = JSON.parse(payload) as OAuthTokenBundle;
    await writeFile(
      accountPath(provider, accountId),
      encrypt(JSON.stringify(reparsed)),
      "utf8"
    );
  } catch {
    /* non-fatal */
  }
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
  ensureOAuthSecretsLoaded();
  await ensureProviderDir(bundle.provider);
  const payload = encrypt(JSON.stringify(bundle));
  await writeFile(accountPath(bundle.provider, bundle.accountId), payload, "utf8");
}

export async function readOAuthBundle(
  provider: string,
  accountId?: string
): Promise<OAuthTokenBundle | null> {
  ensureOAuthSecretsLoaded();
  ensureDirSync(provider);
  if (accountId) {
    try {
      const raw = await readFile(accountPath(provider, accountId), "utf8");
      const decoded = decryptPayload(raw);
      if (!decoded) return null;
      const bundle = JSON.parse(decoded.json) as OAuthTokenBundle;
      await maybeMigrateEncryptedFile(provider, accountId, decoded.json, decoded.key);
      return bundle;
    } catch {
      return null;
    }
  }
  const all = await listOAuthAccounts(provider);
  return all[0] ?? null;
}

function ensureDirSync(provider: string): void {
  ensureOAuthRootSync();
  const dir = providerDir(provider);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function listOAuthAccounts(provider: string): Promise<OAuthTokenBundle[]> {
  ensureOAuthSecretsLoaded();
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
    const accountId = f.slice(0, -".json".length);
    try {
      const raw = await readFile(path.join(dir, f), "utf8");
      const decoded = decryptPayload(raw);
      if (!decoded) continue;
      out.push(JSON.parse(decoded.json) as OAuthTokenBundle);
      await maybeMigrateEncryptedFile(provider, accountId, decoded.json, decoded.key);
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
