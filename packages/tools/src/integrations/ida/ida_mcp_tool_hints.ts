/**
 * Per-tool hints for ida-pro-mcp tools — expert RE workflows for the model.
 */

const INT_CONVERT_HINT =
  "NEVER convert hex/dec/bytes manually — use int_convert for every base change.";

const DATABASE_HINT =
  "database/session_id auto-injected after idb_list/idb_open when only one session is active.";

const PATCH_EXPORT_HINT =
  "After patch/patch_asm: apply_patches_to_input({ output_path }) writes a patched PE/DLL on disk. " +
  "Use get_input_metadata for input_path. Verify with shell (hash, strings).";

const SURVEY_HINT =
  "Start broad: survey_binary → list_funcs/imports → decompile targets → xrefs_to/callees.";

const ANALYZE_HINT =
  "analyze_funcs gives decompile+disasm+xrefs in one call — prefer over many tiny reads.";

const WRITE_PATCH_HINT =
  "patch({addr, data:'b0 01 c3'}) or patch_asm({addr, asm:'mov al, 1; ret'}). Approval-gated.";

const DBG_HINT = "Debugger tools need MCP URL ?ext=dbg (set AGENT_IDA_MCP_DBG_EXT=1).";

export function enrichIdaMcpToolDescription(
  connectionName: string,
  remoteName: string,
  baseDescription: string
): string {
  if (connectionName !== "ida") return baseDescription;

  const remote = remoteName.toLowerCase();
  const hints: string[] = [];

  if (remote === "int_convert") hints.push(INT_CONVERT_HINT);
  if (remote === "survey_binary") hints.push(SURVEY_HINT);
  if (remote === "analyze_funcs") hints.push(ANALYZE_HINT);
  if (remote === "apply_patches_to_input") hints.push(PATCH_EXPORT_HINT);
  if (remote === "get_input_metadata") hints.push(PATCH_EXPORT_HINT);
  if (remote === "patch" || remote === "patch_asm") hints.push(WRITE_PATCH_HINT, PATCH_EXPORT_HINT);
  if (remote === "py_eval") {
    hints.push("Escape hatch for IDA scripting — prefer dedicated tools when available.");
  }
  if (remote.startsWith("dbg_")) hints.push(DBG_HINT);
  if (
    remote !== "idb_list" &&
    remote !== "idb_open" &&
    remote !== "idalib_list" &&
    remote !== "idalib_open" &&
    remote !== "server_health"
  ) {
    hints.push(DATABASE_HINT);
  }

  if (hints.length === 0) return baseDescription;
  const unique = [...new Set(hints)];
  return `${baseDescription}\n${unique.map((h) => `RE: ${h}`).join("\n")}`;
}
