/**
 * Entitlement gate — the keystone of the open-core (CE/EE) split.
 *
 * Liminal Community (CE) is fully usable with **no license**: {@link resolveEntitlements}
 * returns the {@link COMMUNITY_ENTITLEMENTS} set when no token is present, so the local
 * harness never degrades for free users. Paid (EE) surfaces — cloud memory sync, team
 * shared memory, audit log, governance — check {@link hasEntitlement} before activating.
 *
 * Licenses are compact, offline-verifiable tokens (`<payloadB64url>.<sigB64url>`) signed
 * by the Vireon control plane with an **Ed25519** private key. The harness only ever holds
 * the *public* key, so it can verify but never mint a license. Verified licenses are cached
 * to `~/.liminal/license.json` and honored through a bounded **offline grace window** past
 * `exp`, so a brief control-plane outage never locks out a paying customer.
 *
 * Security note: this module ships in the FSL CE source on purpose. Safety comes from key
 * custody (the private key lives only in the control plane), not from code secrecy. The
 * EE feature *implementations* live in the separate proprietary `@liminal/enterprise`
 * package and are gated here by entitlement key.
 */
import { createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { globalPath, ensureGlobalStorageRoot } from "./global_storage.js";

/** License tiers, lowest → highest. Higher tiers inherit all lower-tier entitlements. */
export const LICENSE_TIERS = ["community", "pro", "team", "enterprise"] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

/**
 * Canonical entitlement keys. Format: `<tier-or-area>.<feature>`. EE code paths and the
 * forthcoming `@liminal/enterprise` tool families check these. Keep additions append-only
 * so issued licenses stay forward-compatible.
 */
export const ENTITLEMENTS = {
  /** Pro: sync typed memory + vault across machines via the control plane. */
  PRO_CLOUD_SYNC: "pro.cloud_sync",
  /** Pro: cloud-stored, searchable session history. */
  PRO_SESSION_HISTORY: "pro.session_history",
  /** Pro: optional Vireon-managed inference key (metered). */
  PRO_MANAGED_INFERENCE: "pro.managed_inference",
  /** Team: hosted, multi-tenant shared memory bus keyed by workspace/org. */
  TEAM_SHARED_MEMORY: "team.shared_memory",
  /** Team: ship session events to the control-plane audit log. */
  TEAM_AUDIT_LOG: "team.audit_log",
  /** Team: org-level role-based access control. */
  TEAM_RBAC: "team.rbac",
  /** Team: org-managed centralized settings / fleet config. */
  TEAM_FLEET_CONFIG: "team.fleet_config",
  /** Team: org-level tool/approval policy governance. */
  TEAM_POLICY_GOVERNANCE: "team.policy_governance",
  /** Enterprise: SSO / SAML / SCIM. */
  ENT_SSO: "enterprise.sso",
  /** Enterprise: self-hosted control plane. */
  ENT_SELF_HOST: "enterprise.self_host",
} as const;

export type EntitlementKey = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS];

/** What each tier grants. Higher tiers are unions of all lower tiers (built below). */
const TIER_OWN_ENTITLEMENTS: Record<LicenseTier, readonly EntitlementKey[]> = {
  community: [],
  pro: [ENTITLEMENTS.PRO_CLOUD_SYNC, ENTITLEMENTS.PRO_SESSION_HISTORY, ENTITLEMENTS.PRO_MANAGED_INFERENCE],
  team: [
    ENTITLEMENTS.TEAM_SHARED_MEMORY,
    ENTITLEMENTS.TEAM_AUDIT_LOG,
    ENTITLEMENTS.TEAM_RBAC,
    ENTITLEMENTS.TEAM_FLEET_CONFIG,
    ENTITLEMENTS.TEAM_POLICY_GOVERNANCE,
  ],
  enterprise: [ENTITLEMENTS.ENT_SSO, ENTITLEMENTS.ENT_SELF_HOST],
};

/** Entitlements granted by a tier, including everything inherited from lower tiers. */
export function entitlementsForTier(tier: LicenseTier): EntitlementKey[] {
  const out = new Set<EntitlementKey>();
  for (const t of LICENSE_TIERS) {
    for (const e of TIER_OWN_ENTITLEMENTS[t]) out.add(e);
    if (t === tier) break;
  }
  return [...out];
}

/** The free Community Edition entitlement set — what an unlicensed install gets. */
export const COMMUNITY_ENTITLEMENTS: readonly EntitlementKey[] = entitlementsForTier("community");

/** Decoded, *unverified* license payload (the JSON inside the token). */
export interface LicensePayload {
  /** Token format version. */
  v: 1;
  /** Subject — license/customer id. */
  sub: string;
  /** Tier. Grants the tier's entitlements plus any explicit `ent` extras. */
  tier: LicenseTier;
  /** Optional explicit extra entitlements beyond the tier (for add-ons / overrides). */
  ent?: string[];
  /** Seat count (informational for the harness; enforced server-side). */
  seats?: number;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. After this + grace the license is treated as community. */
  exp: number;
  /** Issuer. */
  iss?: string;
  /** Optional org / workspace binding. */
  org?: string;
}

export type EntitlementStatus =
  | "community" // no token → free tier
  | "active" // verified + unexpired
  | "grace" // verified but expired within the offline grace window
  | "expired" // verified but past grace → downgraded to community
  | "invalid"; // signature/parse failure → downgraded to community

/** Resolved entitlement set the rest of the harness consumes. */
export interface ResolvedEntitlements {
  tier: LicenseTier;
  status: EntitlementStatus;
  entitlements: Set<string>;
  /** The verified payload, when a valid/grace token was present. */
  license: LicensePayload | null;
  /** Human-readable reason, useful for logs and the Settings UI. */
  reason: string;
}

/**
 * Vireon control-plane license-signing **public** key (Ed25519, SPKI PEM).
 * Replaced with the real key at release. Overridable via `AGENT_LICENSE_PUBLIC_KEY`
 * (PEM) for self-hosted/enterprise control planes. Empty placeholder = no built-in key,
 * so only an env-provided key can verify (CE still works fully without any key).
 */
export const VIREON_LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAht86izvwozOwLOuqtFAv4xU7oWi9l38NhfRd2lT+ylg=
-----END PUBLIC KEY-----
`;

const LICENSE_KEY_ENV = "AGENT_LICENSE_KEY";
const LICENSE_PUBLIC_KEY_ENV = "AGENT_LICENSE_PUBLIC_KEY";
const LICENSE_GRACE_DAYS_ENV = "AGENT_LICENSE_GRACE_DAYS";
const DEFAULT_GRACE_DAYS = 14;

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/**
 * Parse a token into its payload without verifying the signature. Never trust the result
 * for gating — use {@link verifyLicenseToken}. Exposed for diagnostics / Settings display.
 */
export function parseLicenseToken(token: string): LicensePayload | null {
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[0]).toString("utf8")) as LicensePayload;
    if (!payload || payload.v !== 1 || typeof payload.sub !== "string") return null;
    if (!LICENSE_TIERS.includes(payload.tier)) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  ok: boolean;
  payload: LicensePayload | null;
  reason: string;
}

/**
 * Cryptographically verify a license token against an Ed25519 public key. Checks the
 * signature only — expiry is applied later in {@link resolveEntitlements} so the grace
 * window can be honored.
 */
export function verifyLicenseToken(token: string, publicKeyPem: string): VerifyResult {
  if (!publicKeyPem || !publicKeyPem.trim()) {
    return { ok: false, payload: null, reason: "no public key configured" };
  }
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { ok: false, payload: null, reason: "malformed token" };
  const payload = parseLicenseToken(token);
  if (!payload) return { ok: false, payload: null, reason: "malformed payload" };
  try {
    const key = createPublicKey(publicKeyPem);
    const data = Buffer.from(parts[0], "utf8");
    const sig = b64urlDecode(parts[1]);
    const ok = cryptoVerify(null, data, key, sig); // Ed25519: algorithm must be null
    return ok
      ? { ok: true, payload, reason: "signature valid" }
      : { ok: false, payload: null, reason: "bad signature" };
  } catch (err) {
    return { ok: false, payload: null, reason: `verify error: ${(err as Error).message}` };
  }
}

/**
 * Sign a license payload with an Ed25519 **private** key (PKCS8 PEM). Control-plane /
 * test use only — the harness never has the private key. Lives here so the website's
 * issuance endpoint and the verifier share one token format.
 */
export function signLicenseToken(payload: LicensePayload, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const head = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = cryptoSign(null, Buffer.from(head, "utf8"), key);
  return `${head}.${b64urlEncode(sig)}`;
}

/** True if `set` grants `feature`. Community installs only have CE entitlements. */
export function hasEntitlement(resolved: ResolvedEntitlements, feature: EntitlementKey | string): boolean {
  return resolved.entitlements.has(feature);
}

function resolveGraceMs(): number {
  const raw = process.env[LICENSE_GRACE_DAYS_ENV]?.trim();
  const days = raw ? Number(raw) : DEFAULT_GRACE_DAYS;
  const safe = Number.isFinite(days) && days >= 0 ? days : DEFAULT_GRACE_DAYS;
  return safe * 24 * 60 * 60 * 1000;
}

function communityResult(reason: string): ResolvedEntitlements {
  return {
    tier: "community",
    status: reason === "no license" ? "community" : (reason.startsWith("expired") ? "expired" : "invalid"),
    entitlements: new Set<string>(COMMUNITY_ENTITLEMENTS),
    license: null,
    reason,
  };
}

function buildResolved(payload: LicensePayload, status: "active" | "grace", reason: string): ResolvedEntitlements {
  const set = new Set<string>(entitlementsForTier(payload.tier));
  for (const e of payload.ent ?? []) set.add(e);
  return { tier: payload.tier, status, entitlements: set, license: payload, reason };
}

export interface ResolveEntitlementsOptions {
  /** License token; defaults to `AGENT_LICENSE_KEY`, then the on-disk cache. */
  token?: string | null;
  /** Override public key (PEM); defaults to `AGENT_LICENSE_PUBLIC_KEY` then the built-in key. */
  publicKeyPem?: string;
  /** Injectable clock for tests (epoch ms). */
  now?: number;
}

function resolvePublicKey(opts?: ResolveEntitlementsOptions): string {
  return (opts?.publicKeyPem ?? process.env[LICENSE_PUBLIC_KEY_ENV] ?? VIREON_LICENSE_PUBLIC_KEY_PEM ?? "").trim();
}

/**
 * Resolve a license token into a usable entitlement set. Pure given its inputs (no disk I/O):
 * pass a token explicitly or via `AGENT_LICENSE_KEY`. For disk-cache + offline-grace
 * resolution use {@link loadResolvedEntitlements}.
 */
export function resolveEntitlements(opts?: ResolveEntitlementsOptions): ResolvedEntitlements {
  const token = (opts?.token ?? process.env[LICENSE_KEY_ENV] ?? "").trim();
  if (!token) return communityResult("no license");

  const publicKeyPem = resolvePublicKey(opts);
  const verified = verifyLicenseToken(token, publicKeyPem);
  if (!verified.ok || !verified.payload) return communityResult(`invalid: ${verified.reason}`);

  const now = opts?.now ?? Date.now();
  const expMs = verified.payload.exp * 1000;
  if (now <= expMs) return buildResolved(verified.payload, "active", "active");

  const graceMs = resolveGraceMs();
  if (now <= expMs + graceMs) {
    return buildResolved(verified.payload, "grace", "expired — within offline grace window");
  }
  return communityResult(`expired ${Math.floor((now - expMs) / 86_400_000)}d past grace`);
}

// ── Disk cache (offline grace) ──────────────────────────────────────────────

const LICENSE_CACHE_FILE = "license.json";
const SECURE_FILE_MODE = 0o600;

interface LicenseCacheRecord {
  version: 1;
  token: string;
  cachedAt: number;
}

export function licenseCachePath(): string {
  return globalPath(LICENSE_CACHE_FILE);
}

export async function readCachedLicenseToken(): Promise<string | null> {
  try {
    const raw = await readFile(licenseCachePath(), "utf8");
    const rec = JSON.parse(raw) as LicenseCacheRecord;
    return rec && rec.version === 1 && typeof rec.token === "string" ? rec.token : null;
  } catch {
    return null;
  }
}

export async function writeCachedLicenseToken(token: string): Promise<void> {
  await ensureGlobalStorageRoot();
  const p = licenseCachePath();
  await mkdir(path.dirname(p), { recursive: true });
  const rec: LicenseCacheRecord = { version: 1, token, cachedAt: Date.now() };
  await writeFile(p, JSON.stringify(rec, null, 2), { encoding: "utf8", mode: SECURE_FILE_MODE });
  await chmod(p, SECURE_FILE_MODE);
}

/**
 * High-level resolver used by the harness at startup: take the env token if present
 * (and refresh the disk cache from it), otherwise fall back to the cached token so a
 * paying user keeps EE features offline. Downgrades cleanly to community on any failure.
 */
export async function loadResolvedEntitlements(
  opts?: ResolveEntitlementsOptions
): Promise<ResolvedEntitlements> {
  if (opts?.token?.trim()) {
    return resolveEntitlements({ ...opts, token: opts.token.trim() });
  }
  const cached = await readCachedLicenseToken();
  const envToken = (process.env[LICENSE_KEY_ENV] ?? "").trim();
  const preferEnv = process.env["AGENT_LICENSE_PREFER_ENV"] === "1";
  const token = preferEnv ? envToken || cached : cached || envToken;
  if (!token) return communityResult("no license");
  const resolved = resolveEntitlements({ ...opts, token });
  if (resolved.license && token === envToken && envToken && !preferEnv && !cached) {
    try {
      await writeCachedLicenseToken(envToken);
    } catch {
      /* best-effort */
    }
  }
  return resolved;
}

// ── Tool-family gating hook ─────────────────────────────────────────────────

/**
 * Map of tool family id → entitlement required to activate it. Populated as the
 * proprietary `@liminal/enterprise` families register (e.g. `cloud_sync` →
 * `ENTITLEMENTS.PRO_CLOUD_SYNC`). Empty here means CE gates nothing — every family
 * in the open-core repo stays freely activatable.
 */
export const ENTITLEMENT_GATED_FAMILIES: Record<string, EntitlementKey> = {};

/** Filter a list of family ids down to those the current entitlements allow to activate. */
export function gateFamiliesByEntitlements(
  familyIds: readonly string[],
  resolved: ResolvedEntitlements
): string[] {
  return familyIds.filter((id) => {
    const required = ENTITLEMENT_GATED_FAMILIES[id];
    return !required || resolved.entitlements.has(required);
  });
}

/** True if a family is allowed to activate under the current entitlements. */
export function isFamilyEntitled(familyId: string, resolved: ResolvedEntitlements): boolean {
  const required = ENTITLEMENT_GATED_FAMILIES[familyId];
  return !required || resolved.entitlements.has(required);
}
