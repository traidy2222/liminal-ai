# REA 6.4 / IDA headless compatibility repair

This is an explicit, local compatibility repair for the exact observed
`rea-agents` 6.4.0 and `ida-pro-mcp` 2.0.0 installation. It is not an engine
installer, automatic update or app-launch hook. Other versions or changed source
fingerprints are refused. Prefer a verified upstream fix when available; do not
carry these patched files across an upgrade.

The reproduced failures were independent of Liminal's MCP transport:

- A valid IDA `server_health` busy response was parsed as malformed metadata.
- Headless IDA's main-thread pump ran requests but did not give queued automatic
  analysis idle work after decompilation. Subsequent readiness stayed false.
- A released worker's inventory tombstone could cause a false cleanup failure.
- An acknowledged worker close could precede the registry's eventual removal,
  briefly leaving an active empty-ID row that must not be ignored.
- Valid Hex-Rays inability to decompile a function and explicit lookup misses
  were incorrectly reported as unreadable producer output.
- The provider rejected even the narrow PS2 MIPS executable profile verified by
  real static analysis of both supplied game boot executables.

Run from the repository root to inspect the exact file paths, original/patched
SHA-256 values and backup paths. The default performs no writes:

```powershell
node scripts/repair-rea-ida-backend.mjs
```

After reviewing the plan and allowing your owned REA/IDA requests to finish, apply
explicitly, then start a fresh owned analysis session:

```powershell
node scripts/repair-rea-ida-backend.mjs --apply
```

For a different installation location, use absolute roots with `--rea-root`
(the `rea-agents` package directory) and `--ida-site-packages` (the Python
site-packages directory). Version and fingerprint checks remain mandatory.
The script does not read credentials, edit registrations/settings, stop sessions,
install dependencies or alter approval/model configuration.

Five original files get byte-for-byte `.liminal-rea-ida-v1.bak` backups. Existing
conflicting backups or helper files are refused. All inputs are checked before
writes; failed application restores completed writes. Reapplying is a no-op.
An installation with the known earlier readiness repair can be upgraded only
when its original backup still has the expected fingerprint. New transforms
always use that verified original; backups remain immutable. If an upgrade
fails, rollback restores the immediately preceding repaired source bytes.
To revert, stop your owned analysis session, copy each listed backup over its
corresponding source file, then remove only the four helper files listed in the
plan. Keep backups until the replacement has been verified.

The REA repair polls **only** health for at most the smaller of 30 seconds and
the existing provider timeout, using a monotonic deadline. It accepts valid busy
responses and schema-valid `auto_analysis_ready:false` as transient. Malformed
responses, unknown readiness, target/hash/image-base changes, cancellation and
timeout still fail. A readiness timeout uses REA's existing `AnalysisTimeoutError`
and names `server_health: headless analysis readiness`, rather than misreporting
malformed output. Each health request gets the remaining timeout and abort
signal. The analysis action is never replayed.

After a verified owned worker close, only the exact upstream released-worker
row (`backend:worker`, empty session ID, unowned, inactive) is ignored when
checking the same private input path. Every remaining session ID, owned/active
worker and GUI row continues to block cleanup. The repair polls only `idb_list`
at 100 ms intervals, for at most the smaller of ten seconds and the configured
provider timeout, to let acknowledged teardown settle. An active empty-ID row
must disappear or become the strict released shape; it is never ignored while
active. Persistent rows, malformed inventory and a blocked producer fail and
retain the workspace. Neither close nor analysis is replayed. This narrowly follows the
[upstream session handling](https://github.com/morluto/rea/blob/main/src/ida/IdaSessionClient.ts).

A schema-valid terminal decompiler page containing null code and a nonempty
error becomes a capability limitation with fixed safe Hex-Rays/assembly
guidance. It is never successful pseudocode. Explicit producer-valid `Not found`
or `Not a function` lookup results become invalid input with procedure-search
guidance. Missing/inconsistent fields, malformed pages and other backend
failures remain errors; no analysis action is retried automatically.

The provider admits only the independently verified PS2 ELF profile:
ELF32 little-endian version 1, executable type, EM_MIPS, exact `0x20924001` flags,
nonzero aligned entry, a regular file, and bounded in-file program headers.
The helper reads 52 header bytes, without loading the binary into memory.
Both supplied Ghost Rider and Futurama boot executables completed actual IDA
health, procedure-list, pseudocode, assembly and dossier checks in owned
headless sessions. This is conditional static support for that observed
profile, not support for every MIPS ABI/ISA or a claim of source recovery.
Other MIPS profiles remain unsupported; the installed IDA loader, engines and
license still determine whether a particular analysis is available. No game
filenames, local paths or target offsets participate in admission.

The Python repair advances analysis only when the owned headless pump is active
and on its IDA main thread. It performs at most 256 `auto_make_step(0, BADADDR)`
steps and checks a 250 ms/tool-deadline budget between steps. One native step
cannot be preempted, so 250 ms is not a hard per-call wall-clock guarantee. GUI
behavior is unchanged. Errors propagate, queues are not deleted, and readiness
continues to come from the original health implementation.
[Hex-Rays documents](https://python.docs.hex-rays.com/ida_auto/index.html) that
`auto_make_step` analyzes one address and `auto_is_ok` reports empty queues.

Focused checks use isolated fixture installations and fake IDA state:

```powershell
node --test scripts/rea-ida-backend/health-readiness.test.mjs scripts/rea-ida-backend/repair.test.mjs scripts/rea-ida-backend/coverage-cleanup.test.mjs scripts/rea-ida-backend/cleanup-settlement.test.mjs scripts/rea-ida-backend/mips-profile.test.mjs scripts/rea-ida-backend/provider-guard.test.mjs
python -m unittest discover -s scripts/rea-ida-backend -p test_headless_health.py
```

These checks do not establish successful real-game decompilation; rerun the
owned native reproducer and game benchmarks after applying the reviewed repair.
