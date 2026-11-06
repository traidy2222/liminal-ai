# Evidence-backed procedural memory: development preview

This vertical slice creates parameterized procedures from observed repository work, verifies outcomes against a user-adopted contract, and checks recorded dependencies before reuse. It currently supports **creating new JSON development records**. General coding procedures and a live-model productivity improvement are not established.

This is an experimental, opt-in feature. A workspace must explicitly adopt its checks before its turns can become procedural evidence.

## User workflow

In the desktop development build, open a chat in the intended workspace, then **More → Procedures**. The activity strip also opens this panel when the harness learns, reuses, suspends or revises a procedure.

1. Place a convention file in the workspace. Use **Inspect checks**, review its actual contents, then **Use these inspected checks**. Adoption freezes a copy outside the learner's writable workspace. An edited file invalidates its preview hash. The model cannot adopt or modify the verifier through a tool.
2. Complete a record task and call `procedure_verify` with that contract and the actual inputs. A wrong output produces a failed receipt even if `write_file` succeeded. Correct the result and verify again.
3. Use `procedure_memory` with `action: learn`, or select the completed source episode in the panel. The result is a candidate. **Verify observed outcome** checks actual files before activation.
4. In a fresh chat/process, relevant active procedures are retrieved as data. `procedure_run` binds new inputs, checks scope/predicates/dependencies, calls normal tools, and verifies the resulting file. Retrievals and verified uses have separate counts.
5. Relevant drift suspends the procedure and linked descendants. An unrelated README edit does not. Adopt a genuinely changed contract, complete a corrected episode and propose a new immutable version. The old evidence remains inspectable. Revision lineage is kept separately from assumption support, so retiring an obsolete version does not quarantine its independently verified repair.

The panel supports failed/successful evidence inspection, paged redacted evidence, lifecycle history, corrections, disable/enable and retirement. **Recover interrupted check** revokes a persisted validation revision and requires fresh verification; it never accepts an old pending result.

Example convention:

```json
{
  "schemaVersion": 1,
  "family": "json-record",
  "name": "Register provider",
  "directory": "src/providers",
  "filenameParameter": "name",
  "fields": {
    "name": { "parameter": "name" },
    "symbol": { "parameter": "symbol" },
    "kind": { "constant": "provider" }
  },
  "allowAdditionalFields": false
}
```

A supported procedure reads its declared convention and creates exactly one new parameterized record. Existing files are never overwritten by procedure execution. Parameter values must be bounded identifiers. An edited approval that changes the target, content or create mode is rejected.

Model-facing tools accept explicit named inputs, for example `inputs: [{"name":"name","value":"record_a"},{"name":"symbol","value":"RecordA"}]`. Use values from the current request and parameter names returned by `procedure_memory` list. Existing nonempty object maps remain compatible. Verification, learning, validation and execution normalize the same representation; missing, duplicate, unknown or malformed values fail before the runtime operation. Successful initial verification and candidate creation provide complete next-step arguments. Verification does not suggest learning again when a usable version already exists.

The default tool catalog and `inspect` are compact; explicit `audit` returns full provenance in 2,000-character content pages, and `evidence` pages individual events. Audit pagination keeps `version_id`; event evidence uses `event_id`. Owner/UI inspection retains full records. Learning/activation results are compact handles rather than copies of the executable/evidence record. Automatic retrieval identifies previously validated active versions separately from unverified notes and bounds derived hints. A successful `procedure_run` returns a receipt, target and verified fields; it already read the convention and checked the actual result, so repeating inspection or verification is unnecessary unless new evidence or user instructions require it. Ordinary tool-based learning does not start a secondary model completion for prose; optional owner/UI metadata generation remains available. Background consolidation avoids another candidate when this contract has a healthy active version, with dependency checks preserved.

Provider schemas are request-local: run is exposed when an active version has current adopted criteria, and verify when a current adopted contract exists. The schemas return after explicit adoption/activation; dispatcher guards still enforce every actual operation. Relevant drift supplies compact factual fallback status. Local dependency checks do not call the model; status prompts and model-chosen metadata work can still consume tokens.

## Reuse and integration map

| Existing surface | Integration |
| --- | --- |
| `packages/core/src/agent.ts` | Per-harness runtime, accepted-turn capture, retrieval as user-role data, optional routed explanation, termination capture, Stop/reset/new-message invalidation, scoped child registration preserved. |
| `dispatcher.ts` | Execution guard runs after existing resource locks, approval and edited-argument validation, immediately before the real handler. No `directCall` authority bypass. |
| `procedural_memory/model.ts` | Versioned schema, typed parameters, binding IR, predicates, provenance, negative examples, scope, evidence/dependencies/support/contradiction references. |
| `procedural_memory/store.ts` | Transactional lifecycle, ordered immutable evidence, immutable versions, receipts, dependency attestations, attempts, derived-memory graph, consolidation claims and backups. |
| `procedural_memory/runtime.ts`, `validation.ts`, `workspace.ts` | Episode extraction, outcome checks, ranking, normal-tool execution, selective suspension, repair, strict concrete workspace identity and path checks. |
| `packages/tools/src/families/memory/procedure_memory.ts` | Harness-owned `procedure_memory`, `procedure_verify`, `procedure_run`; discoverable in `memory_advanced`. |
| `packages/protocol/src/commands.ts`, sidecar `session_bridge.ts`, `ws_server.ts` | Bounded activity transport and owner-only management, contract preview/adoption, source inspection and paged evidence. |
| Desktop model/reducer/controller, `home_screen.dart`, `procedure_panel.dart` | Real backend events and commands, focused current-theme panel; no synthetic learning score. |
| `packages/eval/src/procedural/`, `scripts/*procedur*` | Real harness demo, deterministic comparisons, bounded live driver, native runtime/transport checks and recovery commands. |

Root chat turns are the supported workflow; child-owned tool factories are preserved, but child procedure execution is not established by this delivery. Selecting the correct task contract and parsing the user's requested inputs still depends on the agent or user; a receipt is not proof of arbitrary user-intent understanding.

Existing notes, recipes, trajectory files, session logs and paste-sequence predictions retain their existing meanings. Recipe scores measure process; note sync revisions are not dependency proofs. The legacy JSON writers are not cross-process transactional. They are **not** the authoritative evidence source for this feature and are not promoted into verified procedures.

## Persistence and recovery

Default new-feature storage is `globalPath('procedures', 'procedures.sqlite')`; callers can supply `AgentConfig.proceduralMemory.databasePath`. Merely opening an existing global store in a different project does not start capturing that project's turns: a contract must be adopted for its concrete workspace.

SQLite uses WAL, `synchronous=FULL`, foreign keys, a busy timeout and immediate write transactions. Schema 0 creates schema 1; schema 1 → 2 adds cross-process, expiring consolidation claims. Migrations recheck the schema after acquiring the write transaction. Newer schemas and corrupt databases fail closed without replacing the original bytes.

Immutable version bodies are fingerprinted. Mutable lifecycle revisions and current dependency attestations live separately. Promotion, receipt insertion, dependency attestations and conflict detection share one transaction. Readers see the committed result; a killed transaction rolls back. An interrupted *pre-promotion* check can remain `validating` and requires explicit recovery in the panel. Recovery increments the revision, so a late former worker cannot promote it.

Large, redacted event data is content-addressed under the database's `evidence/` directory. A fully flushed temporary file is atomically published before committing its database reference; concurrent writers cannot publish a partially written canonical artifact. Orphan artifacts or temporary files after a crash are harmless and are not automatically deleted. Evidence pages verify the content fingerprint. This is an application integrity boundary, not protection against an actor with unrestricted OS access.

Workspace identity includes canonical path, filesystem identity, concrete Git directory and branch. It does not include HEAD or remote URL. Different worktrees/branches are not interchangeable; detached HEAD and repositories without remotes work. File deletion/rename triggers revalidation, not automatic semantic relocation. Dependencies include declared file contents, tool schema/handler fingerprints, platform, Node major and an executing-harness source digest. Hash changes trigger revalidation, not a truth judgment.

Support/derived edges are traversed with cycle detection. Retirement or contradicted support quarantines descendants without deleting unrelated knowledge. New derived hypotheses are retrieved only while active. Legacy notes created outside this graph do not acquire lineage automatically. Memory rollback does not undo external side effects or remove a file already created before a later failure.

Explicit-path recovery commands create a new destination and refuse overwrite:

```powershell
node scripts/procedure-store.mjs check --db 'C:\absolute\profile\procedures.sqlite'
node scripts/procedure-store.mjs backup --db 'C:\absolute\profile\procedures.sqlite' --to 'C:\absolute\new-backup'
node scripts/procedure-store.mjs restore --from 'C:\absolute\new-backup' --to 'C:\absolute\new-profile'
```

Backup uses SQLite's online backup, copies the snapshot's referenced evidence and writes a fingerprint manifest. Restore checks that manifest before creating a new profile. It does not switch the installed app to that profile.

`better-sqlite3` is pinned to 12.4.1, with declared support for Node 20/22/23/24. Native ABI smoke checks were added to both desktop bundling scripts. Windows/Node 22 was tested; target Node major/architecture/platform binaries must be validated when packaging. No cross-platform release was produced.

## Extraction, authority and bounded consolidation

Extraction parameterizes an actually observed, structurally correct write that precedes its successful objective receipt. It preserves relevant failures/corrections in order. Optional model output supplies an **inferred explanation**, never executable steps or evaluation criteria, through the existing bounded router and single-model policy. Praise, repeated retrieval and tool success cannot activate a candidate.

Selections bind version, lifecycle revision, workspace, inputs and task revision. They are rechecked after waiting for locks/approval. Stop/reset or a new message during an outstanding task revokes procedural work; a new accepted turn is required before reselection. Late tool results retain their originating episode. Conflicting active record conventions suspend both procedures rather than choosing by score.

`proceduralMemory.enabled: false` disables the feature. Optional `proceduralMemory.consolidate: true` enables at most one deterministic candidate proposal at turn end, with an expiring cross-process claim and no model call or automatic activation. There is no idle auto-dream scheduler or general autonomous skill mining in this slice.

## Validation and limitations

From the repository root:

```powershell
npm run build
npm run typecheck
npm run test:procedures -w packages/core
node --test scripts/experiment-procedural-memory-live.test.mjs scripts/procedure-oracle.test.mjs
```

The tests exercise named inputs, contract adoption, activation, fresh-process reuse, dependency drift, edited approvals, cancellation, concurrent SQLite writers and recovery without downloading or calling a model.

For a deterministic manual demonstration, run `node scripts/demo-procedural-memory.mjs`. It creates disposable repositories and uses separate processes with a scripted controller. `node scripts/compare-procedural-memory.mjs` compares ordinary tools, notes, recipes and procedures on bounded JSON-record tasks. These are mechanism checks; they do not establish a general intelligence, speed or cost improvement.

`scripts/experiment-procedural-memory-live.mjs` is a separate, explicitly invoked paid experiment driver. It uses the configured provider and request budgets. It never runs during startup or CI. Prior selected live tasks demonstrated acquisition and reuse, but token overhead and inconsistent elapsed times leave a general productivity benefit unproven.

For an isolated desktop demonstration, run `node scripts/serve-procedural-demo.mjs`, set `LIMINAL_PROCEDURE_DEMO_CONFIG` to its printed configuration path, and launch the development-only `lib/procedural_demo_main.dart` target. This uses the production panel and WebSocket transport without changing the installed app.
