# Team memory — test coverage & readiness

**Not production-GA.** Team memory shipped in v0.0.17; validate on staging before billing Team customers on sync.

## Automated (CI)

| Area | Tests | Location |
|------|-------|----------|
| Org RBAC roles | role order, viewer vs member gates | `vireondynamics-website` → `src/lib/team/org_auth` (private repo) |
| Team API policy | license org mismatch, chat upload rejected, workspace PUT OK | `npm run e2e:team-licensed` on website |
| Invites | seat limit 409, expired 410 | `src/lib/team/org_invites.test.ts` (website) |
| Sync policy helpers | chat scope, license org match | website team memory helpers |
| Entitlements | `team.shared_memory` on Team tier | `packages/control-plane/src/entitlements.test.ts` (core) |
| Notes facade | org/user stamping | `packages/core/src/notes_facade.test.ts` |
| Recall ranker | sibling + remote fixture | `packages/core/src/memory_rank_federation.test.ts` |
| EE merge/filter | LWW merge, team upload filter | `packages/enterprise/src/note_sync_merge.test.ts` (local EE tree) |

Run:

```bash
npm run e2e:team-licensed   # in vireondynamics-website (private)
npm run test -w @liminal/core
```

## Manual / staging required

- [ ] Apply Supabase migration `20260603000000_org_team.sql` on production CP database
- [ ] Two Team licenses, same org, two machines, same repo fingerprint — A `remember` workspace note, B sees it after a message
- [ ] `scope:chat` note never appears in B's recall or GET team notes
- [ ] Pro `cloud_memory_pull` / `push` against live CP
- [ ] Stripe Team checkout → license includes `org` → owner in `org_members`
- [ ] Invite flow: admin creates invite, second user accepts, seat cap enforced
- [ ] Downgrade Team → Pro: team writes rejected, local notes still work
- [ ] CP unreachable: harness continues offline; sync catches up on reconnect
- [ ] EE bundle built and served (`npm run enterprise:pack`) for `liminal login`

## Known gaps

- No Testcontainers/Supabase integration suite in CI
- No eval scenario `team_memory.ts` (two synthetic users)
- Pro route revision conflict 409 not HTTP-tested yet
- Team bus SSE not HTTP-tested
- Fleet / audit / policy governance entitlements not implemented
