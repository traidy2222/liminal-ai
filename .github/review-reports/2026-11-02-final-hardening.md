# Final PR #2 review repairs

The two remaining conversations were checked against the current PR, including
the already-merged 0.1.7 latency and write-status changes.

| Finding | Disposition and evidence |
| --- | --- |
| [4441484334](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4441484334) | Reproduced: concurrent dispatchers receiving the same provider call ID shared a manifest; validation failure in one removed the other's staging before its handler read it. A second regression reproduced identical staging paths for two sinks in one workspace. Manifests now use a trusted dispatcher identity propagated through async execution, with explicit ownership for harness setup/discard. Direct calls establish their own dispatcher scope. Each sink entry has a unique staging filename. The same two previously failing tests pass, along with a real write_file integration fixture and the existing rejection/append/target checks. |
| [4441484343](https://github.com/traidy2222/liminal-ai/pull/2#discussion_r4441484343) | Coverage request, not a reproduced production defect. Added a successful request through the actual production publicLookup callback and HTTP parser. DNS supplies a public address; only the validated socket destination is redirected to a local HTTP fixture. Assertions prove lookup, validation output and response receipt. No production HTTP transport change was needed. |

Local validation: core and tools builds pass, and 12 focused tests pass with
no skipped, cancelled or TODO cases. CI runs the broader checks on the pushed
commit, including the production-lookup fixture on Node 24. No paid requests,
external model calls or real public network destinations are used by fixtures.

The first ownership fixture mistakenly used a numeric path, which normalization
accepts, and both handlers waited. That cancelled run was blocked, not counted
as a reproduction. The corrected fixture omits a required path and reproduced
two assertion failures before the production fix. Evidence is retained under
ignored `.agent_artifacts/review-loop/1793618695718-c2ccfa90/`; the blocked record
is `1793618605306-bb3a530b`. The ledger verified the ownership repair before the
directCall scope and integration test were added. Its verified state is terminal;
the final source was separately rechecked in `.agent_artifacts/focused-tests.tap`
(12 passing cases), rather than editing/resetting the ledger. The positive DNS fixture initially needed to account
for Node's normalized Socket.connect argument array; its timeout was a fixture
error, not a production transport finding.

Audit-only PR #1 was closed without merging. Its history remains available;
these repairs continue in the normal PR targeting main.
