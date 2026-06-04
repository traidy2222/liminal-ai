import {
  clearVireonAccount,
  loadHarnessEntitlements,
  readVireonAccount,
  runVireonConnectFlow,
  type VireonAccountRecord,
} from "@liminal/core";
import type { ChatRegistry } from "./chat_registry.js";

export interface WireVireonAccountSnapshot {
  connected: boolean;
  account: VireonAccountRecord | null;
  tier: string;
  licensed: boolean;
  entitlements: string[];
  orgId: string | null;
}

export async function buildVireonAccountSnapshot(): Promise<WireVireonAccountSnapshot> {
  const account = await readVireonAccount();
  const ent = await loadHarnessEntitlements();
  const orgId = ent.license?.org?.trim() || null;
  return {
    connected: Boolean(account),
    account,
    tier: ent.tier,
    licensed: Boolean(ent.license),
    entitlements: [...ent.entitlements],
    orgId,
  };
}

export async function vireonSignIn(
  registry: ChatRegistry,
  options: { openBrowser?: boolean } = {}
): Promise<WireVireonAccountSnapshot> {
  await runVireonConnectFlow({
    openBrowser: options.openBrowser !== false,
    onStatus: (m) => console.log(`[vireon] ${m}`),
  });
  await registry.reloadRuntimePrefs();
  await registry.reapplyAllProviders();
  return buildVireonAccountSnapshot();
}

export async function vireonSignOut(registry: ChatRegistry): Promise<WireVireonAccountSnapshot> {
  await clearVireonAccount();
  await registry.reloadRuntimePrefs();
  await registry.reapplyAllProviders();
  return buildVireonAccountSnapshot();
}

/** JSON-safe payload for `vireon_account` transport frames. */
export function wireVireonAccountPayload(snapshot: WireVireonAccountSnapshot) {
  return {
    connected: snapshot.connected,
    account: snapshot.account
      ? (snapshot.account as unknown as Record<string, unknown>)
      : null,
    tier: snapshot.tier,
    licensed: snapshot.licensed,
    entitlements: snapshot.entitlements,
    orgId: snapshot.orgId,
  };
}
