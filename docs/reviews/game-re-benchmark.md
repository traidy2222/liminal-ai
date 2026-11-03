# Local game artifact workflow benchmark

This review uses local PS2 and PC disc images to exercise Liminal's tool discovery,
static inspection, extraction, parser repair and task completion. Source images
are read-only; extracted executables and assets remain local and are not shipped
with this repository. No game was installed or executed.

## Method

The initial runs used the installed 0.1.20 runtime and the configured
`deepseek/deepseek-v4.1-flash-1017` model. Candidate runs use the same provider and
model, real registered tools and Windows PTYs, with fresh output directories and
isolated memory/integration profiles. Only the configured local REA connection
is copied into the test profile. Other accounts and ordinary chats are excluded.

Independent bounded ISO/index reads establish expected member offsets, sizes
and SHA-256 digests. A model saying it finished is not a passing oracle: the
extracted bytes and requested reports must exist and match those checks.

These are single-run diagnostic probes, not a statistical model ranking. Provider
latency, model choices and evolving repairs affect timing. Initial NFS and
Futurama probes included respectively three and one benchmark-driver approval
denials; those are recorded separately from product failures. Later probes allow
ordinary writes/cleanup only in their isolated output directory.

## Tasks and evidence

- **Ghost Rider, PS2:** identify the `SYSTEM.CNF` boot member, extract it, verify
  ELF architecture/entry metadata and attempt relevant REA inspection. The boot
  executable is 4,936,852 bytes. One unrelated ISO member has inconsistent
  dual-endian extent data; inspection reports that member unavailable while
  retaining the valid boot member. MIPS decompilation availability depends on
  the selected engine and host; extracting an ELF does not establish decompilation.
- **Need for Speed Underground 2, PC:** distinguish the installer disc from the
  play disc, identify `SPEED2.EXE` on disc two, distinguish it from setup/launcher
  executables and inspect an extracted binary with REA. The game executable is
  5,987,980 bytes. Installation and target execution are excluded.
- **Futurama, PS2:** infer and validate the IMG index, save a reusable parser and
  inventory, and extract a verified Fry-related container. The independent oracle
  identifies a 2,989,668-byte `fry.ucf` record with a NetImmerse header. That header
  and node-name strings alone do not validate a skeleton or animation export.

## Reproduced product defects and repairs

| Failure | Repair |
| --- | --- |
| `file_metadata` decoded whole binaries and hashed re-encoded UTF-8 | Bounded header/text reads and streaming raw-byte hashes; explicit line-count limits |
| Harmless Python `os.path` inspection was rejected | Guard process-launch primitives while retaining ordinary file inspection and normal approval |
| Re-activating an active family returned failure | Idempotent activation, with genuine unknown/unregistered families still rejected |
| Different long commands shared a 200-character duplicate key | Full canonical argument fingerprints |
| Distinct file slices and reads after edits were labeled repetition | Observation/range/revision-aware tracking |
| Intervening reasoning/discovery hid repeated identical failures | Per-shape failure tracking, reset after actual successful mutations |
| Failed scripts disabled the whole shell for 30 seconds | Separate program outcomes and unsupported targets from infrastructure outages |
| Every repair stayed in a brief reasoning budget | One bounded diagnostic window after repeated program failures; model, effort and settings unchanged |
| No direct ISO or bounded binary observation tools | `inspect_disc_image`, `extract_disc_file`, `read_binary`, with offsets, limits and explicit coverage |
| Parallel extractions raced on a new directory; BOOT2 versioned names failed | Revalidate concurrently created parents and accept the exact on-disc identifier without guessing other versions |
| Classic PowerShell inherited incompatible Core system modules | Filter only identifiable foreign system module roots in child environments; preserve custom paths |
| Stop could end as success or execute queued work | Captured cancellation checks, explicit interrupted status and preserved partial context |
| Timed-out tool results could corrupt the next turn | Pair pending tool messages and reject old batch/cache/context writes |
| Foreground jobs ignored cancellation | Cancel the exact owned process/session tree across PTY and pipe paths; leave independent background tabs alive |
| MCP name queries could omit explicitly requested tools | Rank exact query tool tokens ahead of descriptive keyword matches |
| MCP initialize guidance was discarded | Preserve connector-scoped untrusted guidance, with retained full text for long instructions and lazy legacy-record recovery |
| An explicitly requested artifact provider could be silently skipped | A bounded completion check for grounded local artifact actions, excluding conceptual/documentation/negative requests |

## Observed runs

| Probe | Runtime | Seconds | Tool calls / failures | Independently checked result |
| --- | --- | ---: | ---: | --- |
| Ghost Rider | Installed 0.1.20 | 292 | 31 / 3 | Boot bytes and both reports verified; no MIPS decompilation |
| Ghost Rider | Intermediate candidate | 137 | 28 / 5 | Same boot digest and reports; provider limitation remains |
| NFS Underground 2 | Installed 0.1.20 | 364 | 63 / 11 | Main executable verified, but no Markdown report, final reply or REA inspection |
| NFS Underground 2 | Candidate | 283 | 46 / 8 | Main executable digest, both reports and actual REA procedure/string calls verified |
| Futurama | Installed 0.1.20 | 362 | 61 / 6 | No verified Fry extraction; incorrectly ended with success status after interruption |
| Futurama | Candidate | 602 | 93 / 8 | Fry container digest verified; parser/inventory saved, but reports and decoded skeleton/animations incomplete; explicit timeout |
| NFS launcher function | Candidate, focused follow-up | 227 | 48 / 16 | Actual REA pseudocode and evidence IDs saved, both reports saved, session closed |

Failure counts include schema errors, unsupported operations and backend errors;
they are not all retry loops or Liminal defects. Initial driver denials described
above are included in the baseline counts. Timings are observations, not a causal
speedup claim: intermediate repairs differ, and the final Futurama probe allowed
longer work before the effective turn timeout. No verified skeleton or animation
export was produced. The saved Fry container matches the independent digest, but
its inventory and parser are not certified solely by that one successful extract.

The focused launcher probe reached real IDA/Hex-Rays analysis, then subsequent
operations returned `unreadable_output`. This backend instability remains
unresolved. The saved pseudocode covers an MFC WinMain body, not a reconstruction
of the game engine. Unsupported PS2 MIPS decompilation on the available Windows
provider also remains a technical limit. These probes demonstrate usable tool
execution and some completed evidence, not error-free reverse engineering.

## Validation

Synthetic regressions cover malformed indexes, byte accuracy, sparse large files,
pagination, no overwrite, path/junction escapes, cancellation, late results,
tool activation and MCP contracts. Real Windows fixtures cover module loading,
foreground cleanup and surviving background tabs. Real game outputs stay in the
local benchmark artifact folder for independent review.

The candidate passed the full compiled package build, workspace typecheck,
87 focused regressions, documentation checks and repository secret checks before
submission. CI runs the added artifact/MCP checks on Linux and Windows, and the
real PowerShell/cancellation fixtures on Windows.

A provider's unsupported architecture or operation is reported as a technical
limit. A complete inventory or recovered container does not establish original
source recovery, a runnable port, or a validated character/animation conversion.
