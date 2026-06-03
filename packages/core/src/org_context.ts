/**
 * AsyncLocalStorage-backed org / user context for team memory and cloud sync.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface OrgContext {
  orgId?: string;
  userId?: string;
  licenseSub?: string;
}

const orgStorage = new AsyncLocalStorage<OrgContext>();

export function runWithOrgContext<T>(ctx: OrgContext, fn: () => T): T {
  return orgStorage.run(ctx, fn);
}

export function resolveOrgContext(): OrgContext {
  return orgStorage.getStore() ?? {};
}
