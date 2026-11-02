# CodeRabbit repair-loop continuation — 2026-11-02

This supersedes the remaining-work count and limitations in the earlier
[pilot report](2026-11-02-pilot.md). The artificial audit PR #1 must never be merged.
Changes belong to [repair PR #2](https://github.com/traidy2222/liminal-ai/pull/2).

## Dispositions

- All 76 original comments are triaged: 65 individual repair records, 9 related comments repaired in those same batches, and 2 test-only corrections. 0 original candidates remain untriaged.
- PR #2's 12 current inline follow-ups are also triaged: 11 reproduced fixes and one documentation issue already addressed in the committed instructions.
- These are local regression results, not an assertion that the application is defect-free. No remote review threads were automatically resolved. Nothing was merged or deployed.

Repairs cover approval/shared-chat boundaries, request admission and cancellation,
stream retry deduplication, validated dependency context, per-harness undo state,
provider scheduling, atomic file/preferences writes, browser/terminal cleanup,
bounded shell output, and public-web destination checks. Public web requests check
every redirect and validate DNS addresses inside the socket lookup, avoiding a
second unchecked lookup. Undici 6.24.1 is now an explicit runtime dependency
(already present transitively).

## Validation

- Full build and all workspace typechecks passed. The final link-identity change also passed the tools build.
- Review regressions: 142 passed, no failures/skips, including two additional link-identity regressions.
- Core suite: 550 passed, no failures/skips.
- Affected file/web suites and link regressions: 48 passed, no failures/skips.
- Review-loop evidence gates: 8 passed. Repository secret/default and whitespace checks passed.
- Web client production build passed. An isolated web-server smoke run served built HTML and authenticated /api/config; no chat/model request was submitted.
- Earlier broad sidecar validation had 35 passing assertions but its native Windows PTY process hung after an AttachConsole error. It is not claimed green locally. The required Windows CI job passed on the preceding commit; final CI results are on PR #2.
- Two optional Playwright integration cases were skipped in an earlier focused run. Mocked lifecycle tests do not establish full browser integration behavior.

Provider fixtures use synthetic credentials/mocked responses. The DNS regression
uses a local test server and verifies zero connections after the fix. No paid
model/review invocation was started by these tests.

## Individually reproduced original findings

Historical fingerprints describe each red/green check; later edits make them
stale by design. The combined suite validates the assembled patch.

| Finding | Trigger / regression |
| --- | --- |
| [4440261514](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261514) | Interrupted provider stream redispatches an already running eager tool; preserve its original result across recovery. `packages/core/src/stream_retry_regression.test.ts` |
| [4440261527](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261527) | Corrected fixture reads accumulatedToolCalls; require distinct ID-associated arguments for index-less parallel deltas. `packages/core/src/stream_index_regression.test.ts` |
| [4440261537](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261537) | tryGetCompletedCall substitutes {} before any argument delta arrives; the eager dispatch caller can execute and freeze incomplete calls. Test header-only then split JSON, and preserve explicit {} calls. `packages/core/src/streaming_completion.test.ts` |
| [4440261554](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261554) | Fallback shell capture grows without bound, split UTF-8 is corrupted, and timeout terminates only the shell parent. `packages/tools/src/families/shell/shell_safety_regression.test.ts` |
| [4440261587](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261587) | Lowercase or mixed-case Host headers incorrectly trigger bare-IP rejection. `packages/tools/src/families/web/http_host_regression.test.ts` |
| [4440261598](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261598) | Automatic redirects contact unapproved destinations and can forward custom credentials; return 3xx for explicit approval of each destination. `packages/tools/src/families/web/http_redirect_regression.test.ts` |
| [4440261605](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261605) | max_response_chars reads the entire body before truncation; JSON fallback also attempts to consume an already-used stream. `packages/tools/src/families/web/http_body_regression.test.ts` |
| [4440261619](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261619) | Caller init.signal abort retries immediately-failing requests and delays cancellation through backoff. `packages/tools/src/shared/network_abort_regression.test.ts` |
| [4440261637](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261637) | Confirmed /api/config returns webAuthToken; the auth exemption trusts either a loopback socket or a client-controlled Host. Reproduce forged Host and cross-origin token bootstrap through the middleware. `packages/web/server/local_auth.test.ts` |
| [4440261645](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261645) | Remove unreachable legacy Google callback, unpopulated nonce map and unused anonymous exemption; preserve hosted OAuth handoff. `packages/web/server/dead_callback_regression.test.ts` |
| [4440261650](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261650) | Express 4 async route drops initialization failures and admits concurrent requests across readiness/attachment awaits; reserve each bridge and handle errors. `packages/web/server/message_admission_regression.test.ts` |
| [4440269721](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269721) | The inference session credential is managed as a non-secret, so settings metadata returns its raw environment value and preference fallback is accepted. Test settings output and env-only resolution with synthetic credentials. `packages/core/src/harness_effective_env.test.ts` |
| [4440269733](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269733) | A provider config query deletes process-only AGENT_API_KEY when probing another backend. `packages/core/src/provider_env_regression.test.ts` |
| [4440269767](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269767) | Kimchi request spacing ignores async-local settings even though the general provider override uses them. `packages/core/src/provider_prefs_regression.test.ts` |
| [4440269785](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269785) | A stalled response blocks subsequent starts, same-key nesting deadlocks, and queued cancellation cannot return. `packages/core/src/provider_queue_regression.test.ts` |
| [4440269798](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269798) | Removing an embedded token reconstructs a forbidden outer token, which providers reject. `packages/core/src/provider_scrub_regression.test.ts` |
| [4440269817](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269817) | Writing preferences in place lets concurrent readers observe truncated JSON and drops all settings. `packages/core/src/prefs_atomic_regression.test.ts` |
| [4440269828](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269828) | Every preview refresh leaves another JPEG behind; cookie profile writes also omit owner-only permissions. `packages/tools/src/families/browser/browser_artifacts_regression.test.ts` |
| [4440269845](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269845) | An approved file root on a different Windows drive is split at its drive colon and rejected. `packages/tools/src/families/browser/file_roots_regression.test.ts` |
| [4440269858](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269858) | An in-page click can navigate to an unapproved file URL and subsequent snapshots/actions read it without the explicit navigation guard. `packages/tools/src/families/browser/file_navigation_regression.test.ts` |
| [4440269872](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269872) | Persistent and one-shot browser setup failures leak launched browsers; later failures also leave sessions registered. `packages/tools/src/families/browser/browser_cleanup_regression.test.ts` |
| [4440269937](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269937) | Static preview follows out-of-root symlinks and malformed URL escapes crash its callback; Windows file-root parsing also splits drive letters. `packages/tools/src/families/browser/static_server_regression.test.ts` |
| [4440269969](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269969) | NaN retry limit causes the retry loop to execute zero requests instead of falling back to defaults. `packages/tools/src/shared/network_config_regression.test.ts` |
| [4440269980](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269980) | Final 429/5xx response is returned after its body is cancelled, hiding server error details. `packages/tools/src/shared/network_body_regression.test.ts` |
| [4440270003](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440270003) | Retrying a POST after a server error may duplicate side effects or billed operations; require explicit opt-in. `packages/tools/src/shared/network_method_regression.test.ts` |
| [4440279366](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279366) | Completed JSON containing valid quotes or Markdown is blocked by content heuristics even when the provider reports successful completion. `packages/core/src/content_completion_regression.test.ts`, `packages/tools/src/families/files/content_completion_regression.test.ts` |
| [4440279380](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279380) | Overlapping argument deltas race stream creation and finalize; a valid completed tool call can lose its staged bytes. `packages/core/src/stream_concurrency_regression.test.ts` |
| [4440279393](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279393) | Version-only parsing admits numeric model values and non-string environment overrides that crash typed consumers. `packages/core/src/prefs_shape_regression.test.ts` |
| [4440279405](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279405) | Dependent handlers lose prerequisite results to strict-schema pruning. They need a separate execution context, with dependency-aware cache handling. `packages/core/src/dependency_context_regression.test.ts` |
| [4440279419](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279419) | Autopilot handleFrame approves destructive calls even when snapshot.yolo is false. `packages/sidecar/src/orchestrator_approval_regression.test.ts` |
| [4440279432](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279432) | Stop/restart revives old work; handoff retries run after stop; dependent workers run despite failed or blocked upstream tasks. `packages/sidecar/src/orchestration_lifecycle_regression.test.ts` |
| [4440279446](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279446) | Worker/synthesis readiness failure leaves its chat permanently eligible for auto-approval. `packages/sidecar/src/orchestrator_cleanup_regression.test.ts` |
| [4440279472](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279472) | parseHunk discards real plus/minus-prefixed source lines as if they were file headers. `packages/tools/src/families/files/diff_content_regression.test.ts` |
| [4440279481](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279481) | Corrected instrumentation counts membership scan work; the production fallback scans a growing candidate list quadratically. `packages/tools/src/families/files/diff_search_regression.test.ts` |
| [4440279493](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279493) | Multi-hunk input silently applies only the first hunk while reporting success; enforce the documented single-hunk contract. `packages/tools/src/families/files/diff_hunks_regression.test.ts` |
| [4440279504](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279504) | A failed overwrite truncates the original file and create can overwrite a file that appeared after preflight. `packages/tools/src/families/files/atomic_write_regression.test.ts` |
| [4440279509](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279509) | Staging promotion fails with ENOENT when target parents do not exist; ordinary writes create parents. `packages/tools/src/families/files/stream_directory_regression.test.ts` |
| [4440279521](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279521) | Successful staged writes leave full duplicate content indefinitely; retain staging only on failure. `packages/tools/src/families/files/stream_cleanup_regression.test.ts` |
| [4440279527](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279527) | Stream manifests promote their own target without workspace containment or matching the approved path. `packages/tools/src/families/files/stream_target_regression.test.ts` |
| [4440279535](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279535) | Append verification compares a post-write read to itself, reporting success even when the append loses content. `packages/tools/src/families/files/append_integrity_regression.test.ts` |
| [4440279545](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279545) | A short wait_for_agents timeout cancels the child and loses work despite having a separate cancel_agent tool. `packages/tools/src/families/orchestration/wait_timeout_regression.test.ts` |
| [4440279557](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279557) | If the second critic cannot launch, the first keeps running with no cleanup. `packages/tools/src/families/orchestration/critic_cleanup_regression.test.ts` |
| [4440279565](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279565) | Child creation hooks re-register settings, shell and spawning tools outside an explicit toolNames allowlist. `packages/core/src/child_allowlist_regression.test.ts` |
| [4440279575](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279575) | Lexical containment allows symlink/junction ancestors to write outside a bound workspace, including nonexistent descendants. `packages/tools/src/shared/file_path_regression.test.ts` |
| [4440288710](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288710) | The exported mkdir_p inference incorrectly requests unlink for a directory without proof that this operation created it. Omit the unsupported undo rather than risk existing directories. `packages/core/src/directory_undo_regression.test.ts` |
| [4440288719](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288719) | Repeated buildMessages calls recompress identical history and repeat semantic summarizer work despite unchanged inputs. `packages/core/src/compression_cache_regression.test.ts` |
| [4440288726](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288726) | Context clear leaves old execution-state injection in the next conversation. `packages/core/src/context_clear_regression.test.ts` |
| [4440288756](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288756) | Current normalization coerces non-object JSON into objects, allowing null/scalars to execute optional-argument tools; reject before normalization. `packages/core/src/dispatch_shape_regression.test.ts` |
| [4440288782](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288782) | Approval holds the old-path lock; edited args execute without the correct lock. Acquire after approval and stream preparation. `packages/core/src/dispatch_lock_regression.test.ts` |
| [4440288793](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288793) | The singleton compensation ledger shares undo actions across harnesses and clock-based plan IDs collide in the same millisecond. `packages/core/src/compensation_scope_regression.test.ts` |
| [4440288805](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288805) | Incomplete stream salvage overwrites an existing create-mode target before dispatch, approval or containment; keep bytes only in staging. `packages/core/src/stream_salvage_regression.test.ts` |
| [4440288814](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288814) | Unknown dependency IDs cannot complete but are polled until the full timeout instead of failing immediately. `packages/core/src/dependency_regression.test.ts` |
| [4440288832](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288832) | Shell prefixes approve compound commands and mutating git options; verify explicit human verdict even when classifier would say safe. `packages/core/src/safety_shell_regression.test.ts` |
| [4440288843](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288843) | Oversized args hide actions from the classifier but can still receive safe; fail closed without sending a partial description. `packages/core/src/safety_truncation_regression.test.ts` |
| [4440288856](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288856) | web_fetch literal guard misses bracketed IPv6, alternate loopback, private and link-local addresses. This regression covers literal URLs; DNS rebinding requires transport-level defense separately. `packages/core/src/fetch_address_regression.test.ts` |
| [4440288876](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288876) | PTYs inherit provider credentials; one-shot sessions also fail to fan out data or release sockets/listeners on exit or timeout. Mocked spawn verifies both paths without native PTY. `packages/sidecar/src/pty_lifecycle_regression.test.ts` |
| [4440288899](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288899) | clearSession clears required bootstrap and permits resetting an active harness turn. `packages/sidecar/src/session_reset_regression.test.ts` |
| [4440288918](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288918) | Async connection setup rejection escapes upgrade callback without error delivery or closing the affected socket. `packages/sidecar/src/connection_error_regression.test.ts` |
| [4440288933](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288933) | Broadcast sends unscoped data to guests and all chat frames to a single-chat cloud relay. `packages/sidecar/src/guest_broadcast_regression.test.ts` |
| [4440288940](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288940) | Successful owner initialization retains the 120-second losing race timer. `packages/sidecar/src/init_timer_regression.test.ts` |
| [4440288946](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288946) | A control guest for chat A can reach registry operations on chat B before any ownership check. `packages/sidecar/src/guest_command_regression.test.ts` |
| [4440288968](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288968) | Equivalent relative and absolute write/edit paths acquire different lock IDs while changing the same file. `packages/tools/src/families/files/file_lock_regression.test.ts` |
| [4440297534](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297534) | Corrected bounded fixture: overlapping turn must reject before the first finishes; previous test cancelled instead of asserting. `packages/sidecar/src/session_admission_regression.test.ts` |
| [4440297545](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297545) | Join-token upgrades must authorize session ownership before PTY/browser lookup and upgrade. `packages/sidecar/src/guest_upgrade_regression.test.ts` |
| [4440297565](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297565) | close leaves inbox polling, orchestration, relay configuration and remote UI WebSocket server active. `packages/sidecar/src/server_close_regression.test.ts` |

## Related repairs and test-only corrections

| Finding | Disposition |
| --- | --- |
| [4440261563](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261563) | Reproduced and repaired with 4440261554: Windows taskkill /T /F and POSIX isolated-group termination, escalation and bounded close wait.  |
| [4440261574](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261574) | Reproduced and repaired with 4440261554: stream UTF-8 decoding preserves a multibyte character split across chunks.  |
| [4440269752](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269752) | Test-only improvement: assert key B starts before A finishes and restore original env values with test cleanup, including assertion failures. Existing gate tests pass; production nesting/cancellation has separate red-green coverage.  |
| [4440269778](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269778) | Duplicate root cause addressed with 4440269785: recorded regression covers same-key nesting and stalled responses, then passed after the start-only gate repair.  |
| [4440269791](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269791) | Test-only defect confirmed in source: literal dollar-imEnd never interpolated and test was omitted from core command. Corrected template literal and both tests now pass; included in review regression suite. Not a production bug or red-green production repair.  |
| [4440269888](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269888) | One-shot launch, context, page and navigation failures reproduced and fixed in the 4440269872 browser ownership batch.  |
| [4440269911](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269911) | Fixed and reproduced alongside 4440269937 in static_server_regression.test.ts: malformed percent escapes now return HTTP 400.  |
| [4440269956](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269956) | Cookie permission regression reproduced and passed in 4440269828: directory chmod 0700, new files mode 0600, existing profiles chmod before read/write. Windows POSIX modes do not replace NTFS ACLs.  |
| [4440279437](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279437) | Reproduced and fixed in the 4440279432 lifecycle batch: failed or blocked upstream handoffs skip dependent workers while independent work continues.  |
| [4440279461](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279461) | Reproduced and fixed in the 4440279432 lifecycle batch: stopping a worker prevents additional handoff-repair turns.  |
| [4440288889](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288889) | Reproduced and fixed with 4440288876: one-shot observer/socket fanout, exit listener cleanup and timeout cleanup all pass in the same PTY regression batch.  |

## PR #2 follow-up review

| Finding | Trigger / disposition |
| --- | --- |
| [4440269028](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440269028) | Already addressed in the committed workflow documentation: start uses PR_NUMBER and explains PR 1 audit versus PR 2 repair findings.  |
| [4440269035](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440269035) | A detached test group survives CLI termination because no SIGINT/SIGTERM handler stops it; reproduce with a hanging child and assert prompt exit, persisted interruption and lock cleanup. Windows uses an IPC signal bridge, CI Linux uses a real SIGTERM. `scripts/review-loop.test.mjs` |
| [4440401727](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440401727) | Old preferences retain inference credentials and re-save them; scrub secret keys on load and every save. `packages/core/src/prefs_secret_regression.test.ts` |
| [4440805024](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805024) | Interrupted/truncated staging has no consumer; delete it after composing full-content retry instructions, including failed sinks. `packages/core/src/staging_cleanup_regression.test.ts` |
| [4440805029](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805029) | Failed acquireAll rolls back its partial locks; dispatcher finally must not release sibling ownership a second time. `packages/core/src/lock_rollback_regression.test.ts` |
| [4440805048](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805048) | Failed disk scrubbing must not discard valid sanitized preferences; serialize local load/save to avoid stale scrub rewrites. `packages/core/src/prefs_rewrite_regression.test.ts` |
| [4440805070](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805070) | Classifier HTTP timeout starts after provider spacing, so a valid response is not replaced by a cached timeout verdict while queued. `packages/core/src/safety_queue_regression.test.ts` |
| [4440805078](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805078) | Normalize DNS root trailing dots so localhost aliases cannot bypass the URL argument guard. `packages/core/src/localhost_dot_regression.test.ts` |
| [4440805088](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805088) | Local web_fetch follows redirects and unchecked DNS into private services. Validate every redirect and pin connections using a DNS lookup that returns only validated public addresses. `packages/tools/src/families/web/web_destination_regression.test.ts` |
| [4440805109](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805109) | Rejected null/primitive/array tool arguments violate tool_result event object shape; normalize rejected shapes without executing. `packages/core/src/invalid_args_event_regression.test.ts` |
| [4440805120](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805120) | Atomic overwrite replaced a symlink instead of its target; canonicalize existing targets before creating temporary sibling files. `packages/tools/src/families/files/symlink_write_regression.test.ts` |
| [4440805133](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4440805133) | Recursive regression discovery follows ancestor symlinks and duplicates tests; skip symlinks and dependencies before descending. Added list-only diagnostic before reproduction. `scripts/regression_discovery.test.mjs` |

## Evidence and practical limits

Evidence remains in ignored .agent_artifacts/review-loop/ runs
`1793608322270-6465d19e`, `1793609507588-3777f060`, `1793608608627-bbff4525`.
The correction run preserves and supersedes three invalid first fixtures: a
session-admission wait, a nonexistent stream accessor, and a Node mock applied
to Array.prototype. Corrected fixtures reproduced defects before repairs.
A network reproduction was repeated with stable source after installation
changed its fingerprint. Dependency-context assertions were retained while the
handler context moved to the fourth slot to preserve optional harness callbacks;
the final build and suite pass. Two additional link-identity cases have separate
before/after logs under .agent_artifacts/link-identity-{red,green}.log.

- Workspace canonicalization cannot eliminate filesystem TOCTOU races.
- Atomic overwrite follows existing symlinks, but refuses dangling symlinks and multiply hard-linked files rather than silently destroying link identity.
- Interrupted staging is deleted after building full-content retry instructions; it is never promoted outside normal dispatch. Directory undo is omitted where ownership cannot be safely established.
- Child allowlists retain documented baseline file/discovery and collaboration tools; they are not a read-only sandbox.
- PTY filtering removes credential-named variables, not arbitrary secrets in files or shell startup scripts. POSIX cookie modes do not replace Windows ACLs.
- Public-destination restrictions cover local web_fetch, including fallback reader requests. Explicit network/integration tools have separate policies.
- Mocked process-tree tests and browser URL guards do not constitute an OS sandbox or exhaustive platform/security audit.
