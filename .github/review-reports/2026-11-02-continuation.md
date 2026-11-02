# CodeRabbit repair-loop continuation — 2026-11-02

This report supersedes the remaining-work count and legacy-token limitation in
[the pilot report](2026-11-02-pilot.md). The artificial audit PR #1 must never be merged.
The implementation belongs to the normal [repair PR #2](https://github.com/traidy2222/liminal-ai/pull/2).

## Audit status

- 49 original comments have confirmed production repairs: 47 individual loop records plus two related comments covered by the same regression batches.
- Two comments were test-only improvements, explicitly separated below.
- 25 original comments remain for investigation; this is not a completed security audit.
- PR #2's legacy-secret finding 4440401727 is also fixed: loading/saving preferences removes stored secret keys, including old inference-session tokens.
- No comments were automatically resolved and nothing was merged or deployed.

The repairs cover shell approval decisions, shared-chat authorization, provider
configuration and request scheduling, HTTP retries and response bounds, staged
and atomic file writes, stream parsing, workspace symlinks, task dependencies,
runtime preferences, and server lifecycle cleanup. CI automatically discovers
the new regression files through the review-regressions runner.

## Validation at this checkpoint

- Full build and all workspace typechecks passed.
- Accumulated review regressions: 93 passed, zero failures/skips.
- Core suite: 550 passed, zero failures/skips.
- Existing affected file/browser/provider/sink suites: 34 passed; two opt-in Playwright integration tests skipped.
- Final provider-test and connection-error checks: four passed.
- Broad sidecar suite: 35 assertions passed, but the native Windows PTY test process did not exit after an AttachConsole error and was terminated. This suite is not claimed green.
- Review-loop suite: eight passed. Repository secret scan, typed-default secret check and whitespace validation passed.

Tests use synthetic credentials, temporary files and mocked providers. No paid review or model calls were started.

## Reproduced production findings

Each row records failing assertions before the repair and passing results with
the same regression test afterwards. Historical fingerprints describe the
individual check; the combined suite validates the assembled patch.

| Finding | Confirmed trigger / regression |
| --- | --- |
| [4440261527](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261527) | Corrected fixture reads accumulatedToolCalls; require distinct ID-associated arguments for index-less parallel deltas. Tests: `packages/core/src/stream_index_regression.test.ts`. |
| [4440261537](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261537) | tryGetCompletedCall substitutes {} before any argument delta arrives; the eager dispatch caller can execute and freeze incomplete calls. Test header-only then split JSON, and preserve explicit {} calls. Tests: `packages/core/src/streaming_completion.test.ts`. |
| [4440261587](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261587) | Lowercase or mixed-case Host headers incorrectly trigger bare-IP rejection. Tests: `packages/tools/src/families/web/http_host_regression.test.ts`. |
| [4440261598](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261598) | Automatic redirects contact unapproved destinations and can forward custom credentials; return 3xx for explicit approval of each destination. Tests: `packages/tools/src/families/web/http_redirect_regression.test.ts`. |
| [4440261605](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261605) | max_response_chars reads the entire body before truncation; JSON fallback also attempts to consume an already-used stream. Tests: `packages/tools/src/families/web/http_body_regression.test.ts`. |
| [4440261619](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261619) | Caller init.signal abort retries immediately-failing requests and delays cancellation through backoff. Tests: `packages/tools/src/shared/network_abort_regression.test.ts`. |
| [4440261637](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261637) | Confirmed /api/config returns webAuthToken; the auth exemption trusts either a loopback socket or a client-controlled Host. Reproduce forged Host and cross-origin token bootstrap through the middleware. Tests: `packages/web/server/local_auth.test.ts`. |
| [4440269721](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269721) | The inference session credential is managed as a non-secret, so settings metadata returns its raw environment value and preference fallback is accepted. Test settings output and env-only resolution with synthetic credentials. Tests: `packages/core/src/harness_effective_env.test.ts`. |
| [4440269733](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269733) | A provider config query deletes process-only AGENT_API_KEY when probing another backend. Tests: `packages/core/src/provider_env_regression.test.ts`. |
| [4440269767](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269767) | Kimchi request spacing ignores async-local settings even though the general provider override uses them. Tests: `packages/core/src/provider_prefs_regression.test.ts`. |
| [4440269785](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269785) | A stalled response blocks subsequent starts, same-key nesting deadlocks, and queued cancellation cannot return. Tests: `packages/core/src/provider_queue_regression.test.ts`. |
| [4440269798](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269798) | Removing an embedded token reconstructs a forbidden outer token, which providers reject. Tests: `packages/core/src/provider_scrub_regression.test.ts`. |
| [4440269817](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269817) | Writing preferences in place lets concurrent readers observe truncated JSON and drops all settings. Tests: `packages/core/src/prefs_atomic_regression.test.ts`. |
| [4440269845](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269845) | An approved file root on a different Windows drive is split at its drive colon and rejected. Tests: `packages/tools/src/families/browser/file_roots_regression.test.ts`. |
| [4440269937](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269937) | Static preview follows out-of-root symlinks and malformed URL escapes crash its callback; Windows file-root parsing also splits drive letters. Tests: `packages/tools/src/families/browser/static_server_regression.test.ts`. |
| [4440269969](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269969) | NaN retry limit causes the retry loop to execute zero requests instead of falling back to defaults. Tests: `packages/tools/src/shared/network_config_regression.test.ts`. |
| [4440269980](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269980) | Final 429/5xx response is returned after its body is cancelled, hiding server error details. Tests: `packages/tools/src/shared/network_body_regression.test.ts`. |
| [4440270003](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440270003) | Retrying a POST after a server error may duplicate side effects or billed operations; require explicit opt-in. Tests: `packages/tools/src/shared/network_method_regression.test.ts`. |
| [4440279380](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279380) | Overlapping argument deltas race stream creation and finalize; a valid completed tool call can lose its staged bytes. Tests: `packages/core/src/stream_concurrency_regression.test.ts`. |
| [4440279393](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279393) | Version-only parsing admits numeric model values and non-string environment overrides that crash typed consumers. Tests: `packages/core/src/prefs_shape_regression.test.ts`. |
| [4440279419](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279419) | Autopilot handleFrame approves destructive calls even when snapshot.yolo is false. Tests: `packages/sidecar/src/orchestrator_approval_regression.test.ts`. |
| [4440279446](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279446) | Worker/synthesis readiness failure leaves its chat permanently eligible for auto-approval. Tests: `packages/sidecar/src/orchestrator_cleanup_regression.test.ts`. |
| [4440279472](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279472) | parseHunk discards real plus/minus-prefixed source lines as if they were file headers. Tests: `packages/tools/src/families/files/diff_content_regression.test.ts`. |
| [4440279493](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279493) | Multi-hunk input silently applies only the first hunk while reporting success; enforce the documented single-hunk contract. Tests: `packages/tools/src/families/files/diff_hunks_regression.test.ts`. |
| [4440279504](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279504) | A failed overwrite truncates the original file and create can overwrite a file that appeared after preflight. Tests: `packages/tools/src/families/files/atomic_write_regression.test.ts`. |
| [4440279509](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279509) | Staging promotion fails with ENOENT when target parents do not exist; ordinary writes create parents. Tests: `packages/tools/src/families/files/stream_directory_regression.test.ts`. |
| [4440279521](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279521) | Successful staged writes leave full duplicate content indefinitely; retain staging only on failure. Tests: `packages/tools/src/families/files/stream_cleanup_regression.test.ts`. |
| [4440279527](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279527) | Stream manifests promote their own target without workspace containment or matching the approved path. Tests: `packages/tools/src/families/files/stream_target_regression.test.ts`. |
| [4440279535](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279535) | Append verification compares a post-write read to itself, reporting success even when the append loses content. Tests: `packages/tools/src/families/files/append_integrity_regression.test.ts`. |
| [4440279575](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279575) | Lexical containment allows symlink/junction ancestors to write outside a bound workspace, including nonexistent descendants. Tests: `packages/tools/src/shared/file_path_regression.test.ts`. |
| [4440288726](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288726) | Context clear leaves old execution-state injection in the next conversation. Tests: `packages/core/src/context_clear_regression.test.ts`. |
| [4440288756](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288756) | Current normalization coerces non-object JSON into objects, allowing null/scalars to execute optional-argument tools; reject before normalization. Tests: `packages/core/src/dispatch_shape_regression.test.ts`. |
| [4440288782](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288782) | Approval holds the old-path lock; edited args execute without the correct lock. Acquire after approval and stream preparation. Tests: `packages/core/src/dispatch_lock_regression.test.ts`. |
| [4440288805](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288805) | Incomplete stream salvage overwrites an existing create-mode target before dispatch, approval or containment; keep bytes only in staging. Tests: `packages/core/src/stream_salvage_regression.test.ts`. |
| [4440288814](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288814) | Unknown dependency IDs cannot complete but are polled until the full timeout instead of failing immediately. Tests: `packages/core/src/dependency_regression.test.ts`. |
| [4440288832](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288832) | Shell prefixes approve compound commands and mutating git options; verify explicit human verdict even when classifier would say safe. Tests: `packages/core/src/safety_shell_regression.test.ts`. |
| [4440288843](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288843) | Oversized args hide actions from the classifier but can still receive safe; fail closed without sending a partial description. Tests: `packages/core/src/safety_truncation_regression.test.ts`. |
| [4440288856](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288856) | web_fetch literal guard misses bracketed IPv6, alternate loopback, private and link-local addresses. This regression covers literal URLs; DNS rebinding requires transport-level defense separately. Tests: `packages/core/src/fetch_address_regression.test.ts`. |
| [4440288899](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288899) | clearSession clears required bootstrap and permits resetting an active harness turn. Tests: `packages/sidecar/src/session_reset_regression.test.ts`. |
| [4440288918](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288918) | Async connection setup rejection escapes upgrade callback without error delivery or closing the affected socket. Tests: `packages/sidecar/src/connection_error_regression.test.ts`. |
| [4440288933](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288933) | Broadcast sends unscoped data to guests and all chat frames to a single-chat cloud relay. Tests: `packages/sidecar/src/guest_broadcast_regression.test.ts`. |
| [4440288940](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288940) | Successful owner initialization retains the 120-second losing race timer. Tests: `packages/sidecar/src/init_timer_regression.test.ts`. |
| [4440288946](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288946) | A control guest for chat A can reach registry operations on chat B before any ownership check. Tests: `packages/sidecar/src/guest_command_regression.test.ts`. |
| [4440288968](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288968) | Equivalent relative and absolute write/edit paths acquire different lock IDs while changing the same file. Tests: `packages/tools/src/families/files/file_lock_regression.test.ts`. |
| [4440297534](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297534) | Corrected bounded fixture: overlapping turn must reject before the first finishes; previous test cancelled instead of asserting. Tests: `packages/sidecar/src/session_admission_regression.test.ts`. |
| [4440297545](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297545) | Join-token upgrades must authorize session ownership before PTY/browser lookup and upgrade. Tests: `packages/sidecar/src/guest_upgrade_regression.test.ts`. |
| [4440297565](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440297565) | close leaves inbox polling, orchestration, relay configuration and remote UI WebSocket server active. Tests: `packages/sidecar/src/server_close_regression.test.ts`. |

## Related repairs and test-only changes

| Finding | Disposition |
| --- | --- |
| [4440269752](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269752) | Test-only improvement: assert key B starts before A finishes and restore original env values with test cleanup, including assertion failures. Existing gate tests pass; production nesting/cancellation has separate red-green coverage. |
| [4440269778](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269778) | Duplicate root cause addressed with 4440269785: recorded regression covers same-key nesting and stalled responses, then passed after the start-only gate repair. |
| [4440269791](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269791) | Test-only defect confirmed in source: literal dollar-imEnd never interpolated and test was omitted from core command. Corrected template literal and both tests now pass; included in review regression suite. Not a production bug or red-green production repair. |
| [4440269911](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269911) | Fixed and reproduced alongside 4440269937 in static_server_regression.test.ts: malformed percent escapes now return HTTP 400. |

## Remaining candidates

These are open candidates, not confirmed fixes or dismissed concerns.

| Finding | Area |
| --- | --- |
| [4440261514](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261514) | `packages/core/src/stream_chunk_timeout.ts` |
| [4440261554](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261554) | `packages/tools/src/families/shell/run_shell.ts` |
| [4440261563](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261563) | `packages/tools/src/families/shell/run_shell.ts` |
| [4440261574](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261574) | `packages/tools/src/families/shell/run_shell.ts` |
| [4440261645](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261645) | `packages/web/server/routes.ts` |
| [4440261650](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440261650) | `packages/web/server/routes.ts` |
| [4440269828](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269828) | `packages/tools/src/families/browser/browser_runtime.ts` |
| [4440269858](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269858) | `packages/tools/src/families/browser/browser_runtime.ts` |
| [4440269872](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269872) | `packages/tools/src/families/browser/browser_runtime.ts` |
| [4440269888](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269888) | `packages/tools/src/families/browser/browser_runtime.ts` |
| [4440269956](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440269956) | `packages/tools/src/families/browser/browser_runtime.ts` |
| [4440279366](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279366) | `packages/core/src/file_write_resume.ts` |
| [4440279405](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279405) | `packages/core/src/tool_dag.ts` |
| [4440279432](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279432) | `packages/sidecar/src/chat_orchestrator.ts` |
| [4440279437](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279437) | `packages/sidecar/src/chat_orchestrator.ts` |
| [4440279461](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279461) | `packages/sidecar/src/chat_orchestrator.ts` |
| [4440279481](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279481) | `packages/tools/src/families/files/edit_file.ts` |
| [4440279545](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279545) | `packages/tools/src/families/orchestration/orchestration.ts` |
| [4440279557](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279557) | `packages/tools/src/families/orchestration/orchestration.ts` |
| [4440279565](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440279565) | `packages/tools/src/families/orchestration/orchestration.ts` |
| [4440288710](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288710) | `packages/core/src/compensation_ledger.ts` |
| [4440288719](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288719) | `packages/core/src/context.ts` |
| [4440288793](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288793) | `packages/core/src/execution_state.ts` |
| [4440288876](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288876) | `packages/sidecar/src/pty_manager.ts` |
| [4440288889](https://github.com/traidy2222/liminal-ai/pull/1#discussion_r4440288889) | `packages/sidecar/src/pty_manager.ts` |

## Evidence and limits

Local evidence is in `.agent_artifacts/review-loop/` under runs
`1793608322270-6465d19e`, `1793609507588-3777f060` and
`1793608608627-bbff4525`. The second run corrects two invalid initial fixtures:
an admission test that waited indefinitely and a streaming test that called a
nonexistent accessor. Both corrected tests reproduced their actual defects
before production repairs. The first run retains those failed-fixture records.

Workspace canonicalization does not eliminate filesystem TOCTOU attacks.
The private-address guard covers literal IP addresses, not DNS rebinding.
Interrupted staging bytes are retained for recovery and are never promoted
without normal tool dispatch. Browser integration and the full Windows native
terminal lifecycle are not established by the focused mocked tests.
