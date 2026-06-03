# Team shared memory

Team-tier licenses include the `team.shared_memory` entitlement. It lets every member of an
organization see the same **workspace-scoped** notes for a shared `workspaceFingerprint`
(typically the same git remote), while `chat`-scoped notes stay private to the writing chat.

## How it works

1. **Local federation (CE)** — `remember` / `recall_relevant` still use `~/.liminal/notes.json`
   with `scope: chat | workspace | global`.
2. **Control plane** — org notes are stored under
   `GET/PUT /api/team/memory/notes?org_id=&workspace_fingerprint=`.
3. **Enterprise Edition** — on each turn, EE pulls remote deltas before ReAct round 0 and
   pushes local changes after `turn_end` when `AGENT_TEAM_MEMORY_SYNC=1`.

## Environment

| Variable | Default (EE) | Purpose |
| -------- | ------------ | ------- |
| `AGENT_TEAM_MEMORY_SYNC` | `1` | Enable pull/push against the org store |
| `AGENT_TEAM_EMBED_ON_RECALL` | `0` | When `0`, skip bulk embedding of all notes on recall for org users |
| `AGENT_TEAM_BUS` | `0` | Optional live bus (`/api/team/bus/*`) |
| `AGENT_CONTROL_PLANE_URL` | (empty) | Dev: point EE sync at control plane directly (e.g. `http://localhost:3002`) |

## Roles

Org members have roles (`owner`, `admin`, `member`, `viewer`) enforced on the control plane.
**Chat-scoped notes are never stored in the org API** — only `workspace` and `global` notes sync.
The ranker also hides other chats' `chat` notes locally.

## Offline

If the control plane is unreachable, the harness keeps using local notes. Sync resumes on the
next successful pull when connectivity returns.

See also [Pro & Enterprise features](../reference/pro-and-enterprise.md) and
[Accounts & licensing](./accounts-and-licensing.md).
