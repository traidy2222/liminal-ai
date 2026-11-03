# REA and local MCP servers

Liminal can connect an installed REA server using native MCP stdio. The complete
catalog is registered; on-demand search loads only the relevant definitions into
the model's next request. REA 6.4.0 exposes 170 tools.

## Connect REA

Use the executable and arguments from your existing, working REA installation.
Prefer its installed launcher: a Windows `rea.cmd` wrapper can also configure
the matching Node runtime and an existing IDA provider. Preserve those settings
if you choose to launch its Node script directly instead.
For example, ask Liminal to call:

```json
{
  "name": "rea",
  "command": "rea",
  "args": ["mcp"]
}
```

These are arguments to `mcp_attach_stdio`. Attaching a local executable requires
approval. An installation with a dedicated Node runtime can instead supply that
Node executable and the absolute installed `scripts/rea.mjs` path followed by
`mcp`. Use an existing runtime compatible with your REA version.

The connection is saved in `~/.liminal/api_connections/rea.json`. Helpers start
from `~/.liminal/sidecars/mcp/rea`, outside the desktop installation directory.
They start lazily when a conversation first calls a tool.

For secret environment values, `env_refs` maps child variable names to existing
environment variable names. Values are resolved at startup, never saved in the
connection. `env_paths` accepts existing absolute, non-secret configuration paths,
such as `REA_IDA_MCP_CONFIG` for a working IDA registration.

## Use the tools

Ask a question about a specific artifact and provide its path or selected runtime.
Liminal uses `mcp_search_tools` with `connection: "rea"` to discover and load
matching tools. Search again to change capabilities. REA tools are grouped into
session, native, artifact, JavaScript, runtime, Android and Evidence families.

Concrete requests to inspect or decompile a selected artifact are tool tasks,
even when the final result is an explanation. Liminal starts from a reasonable
legitimate interpretation and the user's stated scope. A commercial title or
copyright notice alone does not establish a request for cracking or distribution.
Ownership and preservation clarifications help continue the task; they are not
prompts for unsupported legal conclusions. Existing tool approvals still apply.

Inspect the artifact before choosing an implementation. Decompilation, a local
emulator launcher and a native platform port require different work. Recovered
pseudocode alone does not establish that a console game can run as a Windows
executable; report actual technical prerequisites and complete supported steps.

Start with `binary_session` to inspect providers, targets and operation
availability. Open the user's native or archive target with `open_binary`.
Target-free JavaScript, managed, resource and capture operations use their own
declared paths or endpoints. REA tool arguments follow the server's original
schema, including nested references and definitions.
With IDA, proceed to available function tools such as `list_procedures`,
`analyze_function` or `procedure_pseudo_code` after opening. `binary_overview`
is unsupported by the IDA provider and is not a prerequisite for decompilation.

Full catalog access does not install engines or bypass host requirements.
Native analysis can use an existing supported IDA or Ghidra configuration;
some operations require another OS, an attached device or an explicitly selected
runtime. The server reports those requirements in `tool_availability`.

## State, results and cleanup

Each conversation and child dispatcher has its own local MCP session, so another
agent cannot replace its active target. Requests support turn cancellation and
progress messages. Transport failures never automatically repeat writes.

Structured Evidence stays in the result. Image and audio blocks are saved with
content hashes under `~/.liminal/mcp_artifacts/rea`; responses contain the local
paths and digests instead of embedding base64 in the prompt. Resource references
are preserved without fetching their URLs. Use retained Evidence views for large
results and export important evidence before ending a session.

`close_binary` releases the selected REA analysis. `mcp_close_session` closes this
conversation's local server while keeping its connection settings. `mcp_detach`
removes the saved connection. Desktop shutdown closes owned local MCP clients.
File changes, process execution and device mutations retain approval checks.

The integration was checked against the full installed REA 6.4.0 catalog, a
static JavaScript fixture and native IDA analysis of a locally compiled fixture.
The native check recovered the expected function logic, closed its owned
database and did not execute the input binary.


## REA 6.4 / IDA headless compatibility

The game workflow investigation reproduced backend failures outside Liminal:
valid busy health was rejected, headless automatic analysis stopped advancing
after decompilation, and acknowledged worker teardown briefly remained in the
session registry. Valid decompiler limitations were also being reported as
malformed output. These are separate from MCP transport failures.

An **explicit local repair** is provided for the exact observed REA 6.4.0 and
ida-pro-mcp 2.0.0 byte layout. From a source checkout, first inspect the dry-run:

```powershell
npm run rea:repair
```

Once your owned native requests have finished, apply the reviewed plan:

```powershell
npm run rea:repair -- --apply
```

This is not an automatic launch hook or an engine upgrade. It checks versions
and original source fingerprints, backs up original files, and refuses unknown
layouts. Model, keys, registrations and approvals are unchanged. It admits the
narrow PS2 ELF32 little-endian MIPS profile actually checked on the supplied game
executables; other MIPS variants and missing engines remain explicit limits.
See the repository's [repair implementation and rollback instructions](https://github.com/traidy2222/liminal-ai/tree/main/scripts/rea-ida-backend).

Large MCP results are preserved as exact local artifacts. Use the returned
`read_artifact` JSON-pointer views rather than guessing response wrappers or
repeating producer operations. Native pseudocode also receives an exact
`verbatim_code_artifact`; copy it when saving code and retain its evidence ID.
A preview is not the canonical complete code. Native header observations
separate entry virtual addresses from file offsets; ELF mappings include the
load segment's file offset.

For unfamiliar assets, preserve source ranges and falsifiable layout hypotheses.
The built-in `recursive_name_table_v1` profile validates the observed Futurama
IMG directory/file grammar and provides a complete inventory and parameterized
read-only reference parser. It is selected explicitly, never inferred solely
from a filename extension. Validated extraction does not establish a decoded
skeleton, animation, native port or recovered original source.
