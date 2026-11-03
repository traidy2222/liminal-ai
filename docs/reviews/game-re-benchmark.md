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

## Initial observed runs (0.1.21 investigation)

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
operations returned `unreadable_output`. This was still unresolved in the initial 0.1.21 investigation; the follow-up below reproduces and repairs it. The saved pseudocode covers an MFC WinMain body, not a reconstruction
of the game engine. At that stage the available Windows provider also rejected PS2 MIPS; the follow-up verifies a narrow static profile instead of assuming all MIPS variants work. These probes demonstrate usable tool
execution and some completed evidence, not error-free reverse engineering.

## Initial validation

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


## REA backend and unfamiliar-format follow-up (0.1.22)

The follow-up retained the configured model and provider. Source images and the
nine existing Futurama tool scripts were not modified. No target was executed,
installed or downloaded. Fresh model runs had isolated output/memory profiles;
independent validators checked source bytes and complete outputs rather than
accepting `terminationReason:ok` as proof of correct interpretation.

### Reproduced backend failures

The failures were reproduced directly through the installed REA SDK, outside
Liminal's MCP adapter. REA 6.4.0 rejected valid busy IDA health, and headless IDA
did not advance queued automatic analysis after decompilation. Acknowledged
worker cleanup could race registry settlement. Valid decompiler limitations and
function lookup misses were erased into generic unreadable-output errors.

The explicit local repair is pinned to REA 6.4.0 and ida-pro-mcp 2.0.0 versions
and exact original/patched fingerprints. It creates immutable original backups,
refuses unknown layouts, and restores previous bytes if application fails.
Health-only polling is bounded; analysis operations are never replayed. Owned
headless analysis advances in bounded steps without forcing readiness. Cleanup
polls only the inventory after acknowledged close and never ignores active or
owned rows. Model settings, keys, registrations and approval policy are unchanged.
See [REA compatibility guidance](../guides/rea.md) and the repository's
[repair implementation](https://github.com/traidy2222/liminal-ai/tree/main/scripts/rea-ida-backend).

Actual direct native checks completed all 12 operations in the original
readiness reproducer and released the owned database. Both supplied PS2 boot
executables also completed real health, procedure list, pseudocode, assembly and
dossier operations. The verified admission extension is limited to their
ELF32 little-endian executable MIPS profile (`e_flags=0x20924001`); installed
engines and licenses still determine availability. Other MIPS variants are not
silently admitted.

### Complete archive evidence

Two independently implemented readers agree on the complete observed Futurama
IMG index: **4,377 records, 4,124 files and 253 directories**, consuming exactly
99,676 index bytes. Directory tags, recursive span boundaries, absolute name
alignment and size/offset ordering are validated. All file extents are in
bounds, sector-aligned and nonoverlapping. The index SHA-256 is
`03ce325d9840c4731b470ff96c5d1efa66c66583703c61ec3c005f104b7d41b4`.
The production inspection reads 99,936 bytes of the 808,962,128-byte archive for
this index/prefix check; it does not hash or decode every payload.

`inspect_binary_archive` supplies the full inventory and a standalone,
parameterized, read-only Python reference parser. Its actual complete output was
rerun and compared record by record against the independent oracle.
`extract_archive_file` validates an exact member and saves its streamed byte
hash. For `chars/fry.ucf`, offset 17,006,592 and size 2,989,668 produce SHA-256
`c33c61af38c135687aaf93c48be2f25f2ecc98ba1cbc6c085eaa3def72fe7af9`.
Other verified Fry-family members also satisfy a request for one related record.
This profile is explicit and structural; `.img` alone does not identify it.

The NetImmerse 4.x header decoder observes version-specific fields and the first
inline type prefix only. In this `fry.ucf`, binary version is a little-endian u32
at byte 40, declared block count is 8,831 at byte 44, and the first inline type is
`NiSequence`. The four binary version bytes are not a NUL plus an unknown
constant; the declared block count is not a first-object payload size. No mesh,
bone hierarchy, skin weights or animation keyframes were structurally decoded.

### Model workflow findings and completed probes

Intermediate failures remain part of the result. Earlier probes saved a partial
4,370-record inventory with thousands of invalid extents, omitted requested
reports at the actual round/time limit, or ignored a correctly validated index
and rewrote obsolete layouts. A native probe retyped one identifier while
claiming verbatim code. Another used incorrect entry arithmetic despite correct
segment fields. A later archive probe completed the inventory, reference parser,
extraction and reports but falsely interpreted known NIF header fields and
misstated the byte range containing some strings. Those are failed interpretations,
not passing whole workflows.

The repairs preserve validated index milestones and partial checkpoints, allow a
useful diagnostic reasoning budget after fallback resolution, retain exact MCP
responses and code artifacts, provide bounded JSON-pointer views, and expose
native address mappings plus measured entry bytes directly from ISO tools.
Requested JSON/Markdown destinations are checked on disk. Explicit source-bound
JSON entry-offset contradictions are rejected. One same-model final evidence
review checks measured header facts, inferred semantics and owned cleanup; it is
not an independent semantic certification.

| Follow-up probe | Seconds | Calls / failures | Independently checked result |
| --- | ---: | ---: | --- |
| Futurama, final archive run | 288 | 57 / 3 | All index records, exact reference parser rerun, Fry byte hash, correct version/count fields, both reports and explicit payload-decoder limit verified |
| Ghost Rider, final native run | 284 | 47 / 9 | Boot identity, mapped entry bytes, exact IDA start pseudocode, both reports and acknowledged session close verified |
| NFS launcher, final focused run | 170 | 25 / 2 | Exact provider code and evidence identifiers saved, conservative report, final handoff and owned close verified |
| NFS actual game executable, earlier focused run | 551 | 100 / 18 | Verified saved provider code; observed loader/protection boundary rather than invented game logic |

Ghost Rider's entry VA `0x25b718` maps through its PT_LOAD segment to file offset
`0x15c718` (1,427,224), including `p_offset=0x1000`. Its measured first entry bytes
are `280c007028140070281c007028240070`. The final native run had no unreadable-output
or cleanup errors. Its broader report still shortened one ancillary module path
incorrectly; the table certifies the named critical checks, not every prose claim.
The NFS launcher is an MFC/CRT launcher, not the game engine. Its final run likewise
had no unreadable-output or cleanup errors, but tried one unavailable operation.

The final archive run was also checked against raw source bytes for the saved
header fields, reported identifier strings and pattern counts. Its detailed
findings correctly separate those observations from decoded objects. Any short
headline about locating skeleton/animation content should be read as candidate
strings, not recovered hierarchy or clips. The validated milestone is the archive,
parser, inventory and Fry record; payload conversion remains unresolved.

These are diagnostic observations across changing candidates, not repeated
identical trials or a statistically established reliability rate. Unsupported
operations, model argument mistakes, local program errors and backend failures
are counted separately by the private validator. Completed static evidence does
not establish original source recovery, a runnable port, protection removal or
full character/animation conversion. Arbitrary unfamiliar formats still require
measured hypotheses, a matching schema or an honest partial handoff.

### Follow-up validation

The compiled package build and workspace typecheck pass. The affected source
checks cover 108 focused regressions; the pinned compatibility repair additionally
passes 27 JavaScript and four Python checks. CI runs the relevant archive, header,
MCP, argument-contract and persistence checks on Linux and Windows. Private game
bytes, model traces, generated game code and credentials are excluded from Git.
