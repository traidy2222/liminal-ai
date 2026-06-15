# Inbox watcher

Background inbox automation polls connected **Gmail** and **Microsoft Outlook** accounts while the Liminal sidecar is running. It uses a three-layer pipeline:

1. **Pre-harness check (zero LLM)** — Gmail `historyId` or Microsoft Graph `deltaLink` detects whether anything changed.
2. **Fast-model triage** — metadata-only classification for new messages (`completeChatJson` on the fast model).
3. **Harness on demand** — user taps **Process** in the desktop inbox panel to escalate items into a full ReAct turn.

Mail is **never auto-sent**. Draft tools remain approval-gated.

## Enable

Set in `.env`, runtime prefs, or **Settings → Session & UI → Inbox watcher**:

```bash
AGENT_INBOX_WATCH=1
```

Connect Gmail and/or Microsoft from **Integrations** first. Without a mail connector the sidecar emits `inbox_watch_skipped` with `reason: "no_connector"`.

## Key settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_INBOX_WATCH` | `0` | Master switch |
| `AGENT_INBOX_WATCH_INTERVAL_MS` | `300000` | Poll interval (5 min) |
| `AGENT_INBOX_WATCH_MIN_INTERVAL_MS` | `60000` | Minimum time between cycles |
| `AGENT_INBOX_WATCH_WHILE_BUSY` | `0` | When off, skip cycles while the harness is running |
| `AGENT_INBOX_WATCH_MAX_TRIAGE_PER_CYCLE` | `10` | LLM triage budget per cycle |
| `AGENT_INBOX_AUTO_LABEL` | `1` | Apply `Liminal/*` labels for high-confidence low-risk mail |
| `AGENT_INBOX_AUTO_SPAM_LABEL` | `0` | Label spam (off by default) |
| `AGENT_INBOX_TRIAGE_CONFIDENCE_MIN` | `0.75` | Minimum confidence to act |
| `AGENT_INBOX_NOTIFY_URGENT` | `1` | Desktop notify for urgent/action items |

## Cursors and baseline

On first poll per account the watcher stores a cursor and **does not triage backlog mail**. The second poll establishes baseline; only mail arriving after that is processed. State lives under:

```
~/.liminal/inbox/
  state-gmail-<accountId>.json
  state-microsoft-<accountId>.json
  queue.json
  processed-ids.json
  rules.json
  triage-YYYY-MM-DD.jsonl
```

## Rules file

`~/.liminal/inbox/rules.json`:

```json
{
  "vipSenders": ["boss@company.com"],
  "newsletterDomains": ["substack.com"],
  "denyDomains": []
}
```

VIP senders bias triage toward `urgent`/`action`. Newsletter domains and `List-Unsubscribe` / `noreply` patterns skip the LLM when possible.

## Auto-label policy

| Category | Auto-label when |
|----------|-----------------|
| `newsletter` / `automated` | confidence ≥ 0.85 → `Liminal/Newsletter` or `Liminal/Automated` |
| `fyi` | confidence ≥ 0.80 → `Liminal/FYI` |
| `urgent` / `action` | No auto-draft; desktop strip + optional notification |
| `spam` | Only if `AGENT_INBOX_AUTO_SPAM_LABEL=1` |

## Desktop UI

When pending items exist, the hub and chat shells show an inbox strip (e.g. `3 new · 1 needs you`). Tap to open the panel:

- **Process** — sends a prefilled prompt to the active chat (creates one if needed).
- **Dismiss** — marks items handled without invoking the harness.

## Smoke test

With Gmail OAuth connected and `AGENT_INBOX_WATCH=1`:

```bash
node scripts/inbox-watch-smoke.mjs
```

Runs one poll cycle via `createInboxProviderPolls` + `runInboxWatchCycle` without starting the full desktop app.

## Privacy

Triage uses subject, from, date, and snippet (≤800 chars) — not full bodies in v1. Audit logs are local JSONL only; nothing is uploaded to Liminal cloud by the watcher itself.
