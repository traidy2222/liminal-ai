# Enterprise features (Pro / Team / Enterprise)

Liminal Enterprise Edition (`@liminal/enterprise`) implements every feature in `packages/enterprise/src/features.ts`. Features are gated by signed license entitlements and wired at startup via `wireEnterpriseHarness`.

## Tiers

| Tier | Entitlements | Highlights |
|------|--------------|------------|
| **Pro** | `pro.cloud_sync`, `pro.session_history`, `pro.managed_inference` | Cloud memory + session history tools; optional auto-sync each turn |
| **Team** | All Pro + `team.shared_memory`, `team.audit_log`, `team.rbac`, `team.fleet_config`, `team.policy_governance` | Org memory sync, audit log shipping, fleet defaults, policy enforcement, RBAC tools |
| **Enterprise** | All Team + `enterprise.sso`, `enterprise.self_host` | SSO issuer discovery, self-hosted control plane URL |

## Tools (by family)

| Family | Tools |
|--------|--------|
| `cloud_sync` | `cloud_memory_pull`, `cloud_memory_push`, `cloud_memory_sync` |
| `session_history` | `cloud_session_upload`, `cloud_session_search`, `cloud_session_fetch` |
| `team_memory` | `team_memory_sync` |
| `team_bus` | `team_bus_publish`, `team_bus_poll` |
| `team_admin` | `team_list_members` |
| `team_policy` | `org_policy_publish` |
| `team_fleet` | `fleet_config_apply`, `fleet_config_publish` |
| `enterprise_managed` | `managed_inference_status` |
| `enterprise_sso` | `enterprise_sso_status` |
| `enterprise_self_host` | `enterprise_self_host_status` |

## Automatic harness hooks

- **Pro auto-sync** (`AGENT_CLOUD_SYNC_AUTO`, `AGENT_SESSION_HISTORY_CLOUD`): push memory / session jsonl on `turn_end`.
- **Team memory** (`AGENT_TEAM_MEMORY_SYNC`): pull on turn start / recall; push on turn end.
- **Audit log** (`AGENT_TEAM_AUDIT_LOG`): ship `turn_end` metrics to `POST /api/team/audit/events`.
- **Fleet config**: fetch and apply org `harnessEnv` overrides on wire + each turn start.
- **Policy governance**: fetch org policy; apply blocked tools via execution commitments and optional forced approvals.

## Control plane

Apply migrations under `packages/control-plane/supabase/migrations/` (including `20260603000001_org_enterprise_extras.sql`), then redeploy the control plane.

Key routes:

- Pro: `GET/PUT /api/pro/cloud_sync/notes`, `GET/POST /api/pro/session_history`
- Team: `GET/PUT /api/team/memory/notes`, `POST /api/team/bus/publish`, `GET /api/team/bus/subscribe`
- Team enterprise: `POST /api/team/audit/events`, `GET/PUT /api/team/fleet/config`, `GET/PUT /api/team/policy`, `GET /api/team/org/members`
- Enterprise: `GET /api/enterprise/sso/config`, `GET /api/enterprise/self_host/status`

Set `AGENT_CONTROL_PLANE_URL` (or `AGENT_VIREON_SITE_URL`) so the EE client reaches your deployment.

## Install EE

```bash
npm run build -w packages/core
npm run build -w packages/tools
npm run build -w packages/enterprise
node scripts/pack-enterprise-bundle.mjs
```

See `packages/enterprise/README.install.md` for tarball install into `~/.liminal/enterprise/`.
