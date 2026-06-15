#!/usr/bin/env node
/**
 * One-shot inbox watch cycle (no sidecar / harness UI).
 * Requires AGENT_INBOX_WATCH=1 and a connected Gmail or Microsoft mail OAuth account.
 */
import OpenAI from "openai";
import {
  resolveInboxWatcherConfig,
  runInboxWatchCycle,
  resetInboxWatcherCycleStateForTests,
  resolveProviderConfig,
} from "@liminal/core";
import { createInboxProviderPolls } from "@liminal/tools";

async function main() {
  const cfg = resolveInboxWatcherConfig();
  if (!cfg.enabled) {
    console.error("Set AGENT_INBOX_WATCH=1 to run the smoke test.");
    process.exit(1);
  }

  resetInboxWatcherCycleStateForTests();

  const provider = resolveProviderConfig();
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
  });

  const polls = await createInboxProviderPolls();
  console.log(`Providers: ${polls.length}`);
  if (polls.length === 0) {
    console.error("No mail connectors — connect Gmail or Microsoft first.");
    process.exit(1);
  }

  const result = await runInboxWatchCycle({
    polls,
    client,
    mainModel: provider.model,
    harnessBusy: () => false,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
