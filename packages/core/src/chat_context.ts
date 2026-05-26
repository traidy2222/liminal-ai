/**
 * AsyncLocalStorage-backed current chat / harness id (federation Phase 2).
 *
 * Mirrors the workspace_root.ts pattern: AgentHarness.send() wraps the entire
 * async chain so every downstream tool — including memory recall — can read
 * the active chat's taskId without threading it explicitly through every
 * factory. The chat id is used to:
 *   1. Hard-filter `scope: "chat"` notes to their writing chat only.
 *   2. Apply the sibling-chat discount when ranking same-workspace notes.
 *   3. Tag new note writes with provenance for cross-chat audits.
 *
 * Outside an active send (eval scenarios, CLI scripts, background jobs) the
 * resolver returns undefined and the ranker degrades gracefully: it drops
 * chat-scope notes (safe default), and skips the sibling discount.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const chatContext = new AsyncLocalStorage<string>();

/** Run `fn` with `chatId` as the active chat for any async work it spawns. */
export function runWithChatId<T>(chatId: string, fn: () => T): T {
  return chatContext.run(chatId, fn);
}

/** Current chat id, or undefined when no active scope (no harness driving). */
export function resolveCurrentChatId(): string | undefined {
  return chatContext.getStore();
}
