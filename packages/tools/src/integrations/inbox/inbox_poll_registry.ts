import type { InboxProviderPoll } from "@liminal/core";
import { applyGmailLabel, listGmailInboxAccounts, pollGmailInbox } from "../google/gmail_inbox_poll.js";
import {
  applyMicrosoftCategory,
  listMicrosoftInboxAccounts,
  pollMicrosoftInbox,
} from "../microsoft/mail_inbox_poll.js";

/** Build inbox poll adapters for all connected mail OAuth accounts. */
export async function createInboxProviderPolls(): Promise<InboxProviderPoll[]> {
  const polls: InboxProviderPoll[] = [];

  const gmailAccounts = await listGmailInboxAccounts();
  for (const acct of gmailAccounts) {
    polls.push({
      provider: "gmail",
      accountId: acct.accountId,
      email: acct.email,
      poll: (cursor) => pollGmailInbox(acct.accountId, cursor),
      applyLabel: async (message, labelName) => {
        const r = await applyGmailLabel(acct.accountId, message.id, labelName);
        return { ok: r.ok, error: r.error, labelApplied: r.labelApplied };
      },
    });
  }

  const msAccounts = await listMicrosoftInboxAccounts();
  for (const acct of msAccounts) {
    polls.push({
      provider: "microsoft",
      accountId: acct.accountId,
      email: acct.email,
      poll: (cursor) => pollMicrosoftInbox(acct.accountId, cursor),
      applyLabel: async (message, labelName) => {
        const r = await applyMicrosoftCategory(acct.accountId, message.id, labelName);
        return { ok: r.ok, error: r.error, labelApplied: r.labelApplied };
      },
    });
  }

  return polls;
}
