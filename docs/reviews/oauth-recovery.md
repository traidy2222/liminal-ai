# OAuth recovery review (PR 10)

The repair covers Google reconnect readiness, hosted provider-token renewal and the local Google Workspace service. Non-Google readiness and generic sidecar diagnostics retain their behavior from main.

| Finding | Disposition and evidence |
| --- | --- |
| [4449280109](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280109) | Reproduced with an expired default account and a usable requested Google account. Readiness now resolves the requested account ID or email, rejects an unknown account, and receives `account_hint` from the caller. The unchanged regression passed after repair. |
| [4449280089](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280089) | Corrected the description's UTF-8 em dash and checked the resulting bytes. Metadata-only validation; no redundant runtime test added. |
| [4449280103](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280103) | Added `pretest:oauth` to build core. Running `npm run test:oauth` performs that build before all 13 OAuth tests pass. |
| [4449280113](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280113) | Withdrew the Xero readiness change. This patch no longer introduces a direct Xero token refresh before sign-in. A separate Xero timeout repair remains outside this Google fix. |
| [4449280119](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280119) | Withdrew the Notion readiness change. This patch does not claim to fix Notion's existing expiry behavior. |
| [4449280125](https://github.com/traidy2222/liminal-ai/pull/10#discussion_r4449280125) | Withdrew the generic sidecar diagnostic change. The improved refresh diagnostic applies only to Google probes that have already found a saved account. |

The local review-loop ledger is `1793664512188-6b212926` under ignored artifacts. The account-selection regression failed for the intended assertion, then passed unchanged. Earlier workspace build/typecheck and Linux/Windows CI passed; the final patch is subject to its own CI and review before merge.
