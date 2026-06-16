# Inbox watcher

Background inbox automation polls connected **Gmail** and **Microsoft Outlook** accounts while the Liminal sidecar is running.

## Pipeline

1. **Pre-harness check (zero LLM)** — Gmail `historyId` or Microsoft Graph `deltaLink` detects changes.
2. **Fast-model triage** — metadata-only classification (`completeChatJson` on the fast model).
3. **Automatic sort** — creates `Liminal/*` labels (Gmail) or categories (Outlook) on triaged mail.
4. **Auto-process (optional)** — urgent/action mail is escalated to the active chat without a manual **Process** click.

Mail is **never auto-sent**. Draft tools remain approval-gated.

## Enable

1. Connect **Gmail** and/or **Microsoft** in **Integrations** (Gmail needs **`gmail.modify`** — reconnect Google after upgrading).
2. Under **Integrations → Automations → Inbox watcher**, enable the watcher.
3. Keep **Sort mail into Liminal labels** and **Auto-handle urgent mail in chat** on (defaults).

## Key settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_INBOX_WATCH` | `0` | Master switch |
| `AGENT_INBOX_WATCH_INTERVAL_MS` | `300000` | Poll interval (5 min) |
| `AGENT_INBOX_WATCH_MIN_INTERVAL_MS` | `60000` | Minimum time between cycles |
| `AGENT_INBOX_WATCH_WHILE_BUSY` | `0` | When off, skip cycles while the harness is running |
| `AGENT_INBOX_WATCH_MAX_TRIAGE_PER_CYCLE` | `25` | LLM triage budget per cycle |
| `AGENT_INBOX_BACKFILL_MAX` | `25` | Unread/recent mail to import on first connect |
| `AGENT_INBOX_AUTO_LABEL` | `1` | Apply `Liminal/*` labels for triaged mail |
| `AGENT_INBOX_AUTO_PROCESS` | `1` | Auto-escalate urgent/action to the agent |
| `AGENT_INBOX_AUTO_SPAM_LABEL` | `0` | Label spam (off by default) |
| `AGENT_INBOX_TRIAGE_CONFIDENCE_MIN` | `0.75` | Minimum confidence to act |
| `AGENT_INBOX_NOTIFY_URGENT` | `1` | Desktop notify for urgent/action items |

## Labels

| Category | Gmail label / Outlook category |
|----------|-------------------------------|
| urgent | `Liminal/Urgent` |
| action | `Liminal/Action` |
| fyi | `Liminal/FYI` |
| newsletter | `Liminal/Newsletter` |
| automated | `Liminal/Automated` |
| spam | `Liminal/Spam` |
| other | `Liminal/Review` |

Labels are created automatically on first use.

## State on disk

```
~/.liminal/inbox/
  state-gmail-<accountId>.json
  state-microsoft-<accountId>.json
  queue.json
  processed-ids.json
  runs.jsonl
  triage-YYYY-MM-DD.jsonl
```

## Smoke test

```bash
node scripts/inbox-watch-smoke.mjs
```

Runs one poll cycle via `createInboxProviderPolls` + `runInboxWatchCycle` without starting the full desktop app.
