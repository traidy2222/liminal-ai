/**
 * Persisted AWS identity records (STS principal — not secret keys).
 */
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { globalPath, ensureGlobalStorageRoot } from "./global_storage.js";
import type { AwsCallerIdentity } from "./aws_cli_identity.js";

const ACCOUNTS_SEG = "aws/accounts.json";

export interface AwsIdentityAccount extends AwsCallerIdentity {
  accountId: string;
  connectedAt: number;
  profile?: string;
  region?: string;
  label?: string;
}

async function accountsPath(): Promise<string> {
  await ensureGlobalStorageRoot();
  return globalPath(ACCOUNTS_SEG);
}

export async function listAwsIdentityAccounts(): Promise<AwsIdentityAccount[]> {
  try {
    const raw = await readFile(await accountsPath(), "utf8");
    const parsed = JSON.parse(raw) as AwsIdentityAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveAwsIdentityAccount(
  identity: AwsCallerIdentity,
  opts?: { profile?: string; region?: string }
): Promise<AwsIdentityAccount> {
  const accounts = await listAwsIdentityAccounts();
  const label = identity.arn.split("/").pop() ?? identity.accountId;
  const row: AwsIdentityAccount = {
    ...identity,
    connectedAt: Date.now(),
    profile: opts?.profile,
    region: opts?.region,
    label,
  };
  const next = [row, ...accounts.filter((a) => a.accountId !== identity.accountId)];
  await mkdir(path.dirname(await accountsPath()), { recursive: true });
  await writeFile(await accountsPath(), JSON.stringify(next, null, 2), "utf8");
  return row;
}

export async function removeAwsIdentityAccount(accountId: string): Promise<void> {
  const accounts = await listAwsIdentityAccounts();
  const next = accounts.filter((a) => a.accountId !== accountId);
  await writeFile(await accountsPath(), JSON.stringify(next, null, 2), "utf8");
}

export async function clearAwsIdentityAccounts(): Promise<void> {
  try {
    await unlink(await accountsPath());
  } catch {
    /* ignore */
  }
}
