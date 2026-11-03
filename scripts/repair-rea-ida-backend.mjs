#!/usr/bin/env node
/** Explicit, pinned compatibility repair. Never invoked during app launch. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const helperRoot = fileURLToPath(new URL("./rea-ida-backend/", import.meta.url));
const backupSuffix = ".liminal-rea-ida-v1.bak";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export const isReleasedWorkerRow = (entry) => entry.backend === "worker" &&
    entry.session_id === "" && entry.owned === false && entry.is_active === false;

function replaceExactlyOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error("Unsupported backend source layout: repair anchor is missing or repeated");
  return text.replace(before, after);
}

export function transformSession(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let text = input.replaceAll("\r\n", "\n");
  text = replaceExactlyOnce(text, 'import { z } from "zod";', 'import { z } from "zod";\nimport { waitForIdaHealth } from "./liminal-health-readiness.mjs";\nimport { settleIdaInventory } from "./liminal-cleanup-settlement.mjs";');
  text = replaceExactlyOnce(text, 'import { AnalysisCancelledError,', 'import { AnalysisTimeoutError, AnalysisCancelledError,');
  text = replaceExactlyOnce(text, 'const before = await this.#observe();', 'const before = await this.#observe(options);');
  text = replaceExactlyOnce(text, 'const after = await this.#observe();', 'const after = await this.#observe(options);');
  text = replaceExactlyOnce(text, 'async #observe() {', 'async #observe(options) {');
  text = replaceExactlyOnce(text, 'const operationSet = new Set(IDA_OPERATIONS);', `// Only the observed released headless-worker tombstone is non-blocking.
// A remaining session ID, ownership/activity flag or any GUI row still blocks.
const isReleasedWorkerRow = ${isReleasedWorkerRow.toString().replaceAll("\r\n", "\n")};
const operationSet = new Set(IDA_OPERATIONS);`);
  text = replaceExactlyOnce(text, `                    const inventory = databaseListSchema.parse(await this.connection.call("idb_list", {}));
                    if (inventory.sessions.some((entry) => entry.session_id === this.#database ||
                        sameIdaHostPath(entry.input_path, this.#workspace?.inputPath ?? "")))
                        throw new AnalysisProtocolError("IDA worker remains registered after close.");`,
    `                    await settleIdaInventory({
                        listInventory: (requestOptions) => this.connection.call("idb_list", {}, requestOptions),
                        parseInventory: (value) => databaseListSchema.parse(value),
                        isBlocking: (entry) => entry.session_id === this.#database ||
                            (!isReleasedWorkerRow(entry) && sameIdaHostPath(entry.input_path, this.#workspace?.inputPath ?? "")),
                        protocolError: (message) => new AnalysisProtocolError(message),
                        budgetMs: Math.min(10_000, this.config.timeoutMs),
                    });`);
  text = replaceExactlyOnce(text, `            const raw = await this.connection.call("server_health", {
                database: this.#database,
            });
            const metadata = modernHealthSchema.parse(raw);
            if (!sameIdaHostPath(metadata.input_path, this.#workspace.inputPath) ||
                (await idaFileDigest(this.#workspace.inputPath)) !== this.target.sha256)
                throw new AnalysisProtocolError("IDA headless input identity changed after target admission.");
            if (metadata.auto_analysis_ready !== true)
                throw new AnalysisProtocolError("IDA auto-analysis is incomplete or readiness is unknown; retry after analysis completes.");`, `            const { raw, metadata } = await waitForIdaHealth({
                callHealth: (requestOptions) => this.connection.call("server_health", {
                    database: this.#database,
                }, requestOptions),
                parseHealth: (value) => modernHealthSchema.parse(value),
                validateIdentity: async (value) => {
                    if (!sameIdaHostPath(value.input_path, this.#workspace.inputPath) ||
                        (await idaFileDigest(this.#workspace.inputPath)) !== this.target.sha256)
                        throw new AnalysisProtocolError("IDA headless input identity changed after target admission.");
                    const observed = JSON.stringify([this.#database, value.input_path, value.idb_path, value.imagebase]);
                    if (this.#initialIdentity !== undefined && observed !== this.#initialIdentity)
                        throw new AnalysisProtocolError("The IDA target or image base changed during readiness observation; reopen the target.");
                },
                protocolError: (message) => new AnalysisProtocolError(message),
                timeoutError: (budgetMs) => new AnalysisTimeoutError("server_health: headless analysis readiness", budgetMs),
                signal: options?.signal,
                budgetMs: Math.min(30_000, this.config.timeoutMs),
            });`);
  return eol === "\r\n" ? text.replaceAll("\n", eol) : text;
}

export function transformRunner(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let text = input.replaceAll("\r\n", "\n");
  text = replaceExactlyOnce(text, 'import { AnalysisInputError,', 'import { AnalysisCapabilityUnavailableError, AnalysisInputError,');
  text = replaceExactlyOnce(text, `            if (item?.fn == null || item.error !== null)
                throw new AnalysisProtocolError(\`IDA function lookup failed for \${query}: \${item?.error ?? "missing function"}\`);`,
    `            if (item?.fn === null && (item.error === "Not found" || item.error === "Not a function"))
                throw new AnalysisInputError("function_lookup", undefined, [{
                    path: ["procedure"], reason: "invalid_value",
                    message: "No function matches the requested procedure. Search or list procedures and use an exact returned name or address.",
                }]);
            if (item?.fn == null || item.error !== null)
                throw new AnalysisProtocolError(\`IDA function lookup failed for \${query}: \${item?.error ?? "missing function"}\`);`);
  text = replaceExactlyOnce(text, `            if (page.code === null || page.error !== undefined)
                throw new AnalysisProtocolError(\`IDA decompilation failed: \${page.error ?? "missing code"}\`);`,
    `            if (page.code === null && typeof page.error === "string" && page.error.trim() &&
                "done" in page.cursor && page.cursor.done === true) {
                const reason = "Hex-Rays could not decompile this function; assembly is available through procedure_assembly or read_function_instructions.";
                throw new AnalysisCapabilityUnavailableError("ida", "procedure_pseudo_code", reason, { userMessage: reason });
            }
            if (page.code === null || page.error !== undefined)
                throw new AnalysisProtocolError(\`IDA decompilation failed: \${page.error ?? "missing code"}\`);`);
  return eol === "\r\n" ? text.replaceAll("\n", eol) : text;
}

export function transformConnection(input) {
  let text = replaceExactlyOnce(input, 'async call(name, args) {', 'async call(name, args, options) {');
  text = replaceExactlyOnce(text, '.callTool({ name, arguments: args }, { timeout: config.timeoutMs })',
    '.callTool({ name, arguments: args }, { timeout: Math.min(config.timeoutMs, options?.timeoutMs ?? config.timeoutMs), signal: options?.signal })');
  return text;
}

export function transformProvider(input) {
  let text = replaceExactlyOnce(input, 'import { IdaSessionClient } from "./IdaSessionClient.js";',
    'import { IdaSessionClient } from "./IdaSessionClient.js";\nimport { verifiedPs2MipsElfTarget } from "./liminal-mips-profile.mjs";');
  text = replaceExactlyOnce(text, 'if (target.kind === "executable" && target.architecture === "mips")',
    'if (target.kind === "executable" && target.architecture === "mips" && !verifiedPs2MipsElfTarget(target))');
  text = replaceExactlyOnce(text, "REA's IDA adapter has no verified MIPS lane. Select a supported Ghidra profile instead.",
    "This MIPS input is outside the verified PS2 ELF32 little-endian profile; other MIPS ABI/ISA variants require a separately verified provider.");
  return text;
}

export function transformPython(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let text = input.replaceAll("\r\n", "\n");
  text = replaceExactlyOnce(text, 'from .mainthread import get_pump', 'from .mainthread import get_pump\nfrom .liminal_headless_health import advance_headless_analysis');
  text = replaceExactlyOnce(text, 'def _server_health_full() -> ServerHealthResult:\n    return _build_health_payload()',
    'def _server_health_full() -> ServerHealthResult:\n    advance_headless_analysis(get_pump(), ida_auto, idaapi.BADADDR, get_tool_deadline())\n    return _build_health_payload()');
  return eol === "\r\n" ? text.replaceAll("\n", eol) : text;
}

// Byte-for-byte allowlist, not a best-effort patch across arbitrary upstream code.
export const supportedLayout = [
  { root: "reaRoot", relative: "dist/ida/IdaSessionClient.js", original: "ab96440a38ec45e7cf20b6d6e52ec610c3d41cb82ebfce792373f6be44ccd89f", previous: ["ed8184d81d5dbbfaeacf4c3926fcb6554579fcb060c279ad127e28cffeadd451", "2238ba0b78d7732c2215af6d1364a3c2ec8deff8b1a44393f3750e1996f93065"], patched: "9a178e6cbc62da5174ad4034249a7a3238e6f1247b0951ee5386019c29e32365", transform: transformSession },
  { root: "reaRoot", relative: "dist/ida/IdaOperationRunner.js", original: "b9ff33af09476c625ebfc1dfbda4dc9fa0da19947d8053274355f3cd6046997c", patched: "57267965e5eb5bd291d4ccebcc8a7044ee3783d974cf137b4de13750e7a7d615", transform: transformRunner },
  { root: "reaRoot", relative: "dist/ida/IdaMcpConnection.js", original: "0e6b782fb02027fcf4acd50dab441dfd2c9eb9472deb65ec083e2d2fbfd926f3", patched: "d6f317c0e8e5e6aa6715b690d931b5a82ef9d8cf20fc9c44050dfea1b67ea8d2", transform: transformConnection },
  { root: "reaRoot", relative: "dist/ida/IdaProvider.js", original: "8ec266d6bf0334642c59093f07275954f062e48c91ef8121c7685c806eb3d1df", patched: "b75c39516009d296ee56d66b0f2fe5406ba589527c21848a2fc6975a251bc278", transform: transformProvider },
  { root: "idaSitePackages", relative: "ida_pro_mcp/ida_mcp/api_core.py", original: "d6851abd2cf74093c4beac26a5be0739ffc5d090fae652bf3d8593b7dfbb3952", patched: "ef2037a1ed8f553f3c38cd1c40a54cc2f9c678aa7884ee790191f9421d73e6e6", transform: transformPython },
  { root: "reaRoot", relative: "dist/ida/IdaProtocolValues.js", original: "7adfbf414166f05cb50cbe7ca76a28534b664af9705957a9ce4dd72ccc1ff797" },
  { root: "reaRoot", relative: "dist/domain/analysisErrorCore.js", original: "0db57ea75028760923aec12e1eb16167b8513abb740855458aeeb37ea13a50f4" },
  { root: "idaSitePackages", relative: "ida_pro_mcp/ida_mcp/mainthread.py", original: "2a915b82402c97795cc52af58c5b80658f4ec26c73aa1b9bd0f2fca924919c1a" },
  { root: "idaSitePackages", relative: "ida_pro_mcp/ida_mcp/sync.py", original: "9871a3ebefe37f2fca77b1e49014877c20acfa616827ff54d634a48cd28ffeff" },
];

async function readOptional(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** A different manifest is injectable for isolated fixture tests, never via CLI. */
export async function planRepair(paths, manifest = supportedLayout) {
  for (const value of Object.values(paths)) if (!path.isAbsolute(value)) throw new Error("Backend roots must be absolute paths");
  const pkg = JSON.parse(await fs.readFile(path.join(paths.reaRoot, "package.json"), "utf8"));
  if (pkg.name !== "rea-agents" || pkg.version !== "6.4.0") throw new Error("Repair supports rea-agents 6.4.0 only");
  const metadata = await fs.readFile(path.join(paths.idaSitePackages, "ida_pro_mcp-2.0.0.dist-info/METADATA"), "utf8");
  if (!/^Name: ida-pro-mcp\r?$/m.test(metadata) || !/^Version: 2\.0\.0\r?$/m.test(metadata)) throw new Error("Repair supports ida-pro-mcp 2.0.0 only");
  const files = [];
  for (const entry of manifest) {
    const file = path.join(paths[entry.root], entry.relative);
    const before = await fs.readFile(file), hash = sha256(before);
    if (hash !== entry.original && hash !== entry.patched && !entry.previous?.includes(hash)) throw new Error(`Unsupported backend fingerprint: ${file} (${hash})`);
    if (!entry.transform) continue;
    const backup = file + backupSuffix;
    const existingBackup = await readOptional(backup);
    if (existingBackup && sha256(existingBackup) !== entry.original) throw new Error(`Conflicting repair backup: ${backup}`);
    if (hash !== entry.original && !existingBackup) throw new Error(`Repaired backend lacks its verified original backup: ${backup}`);
    const backupBytes = existingBackup ?? before;
    const after = hash === entry.patched ? before : Buffer.from(entry.transform(backupBytes.toString("utf8")));
    if (sha256(after) !== entry.patched) throw new Error(`Repair output fingerprint mismatch: ${file}`);
    files.push({ file, before, after, backup, backupBytes, changed: hash !== entry.patched });
  }
  const helperFiles = [
    { source: "health-readiness.mjs", file: path.join(paths.reaRoot, "dist/ida/liminal-health-readiness.mjs") },
    { source: "cleanup-settlement.mjs", file: path.join(paths.reaRoot, "dist/ida/liminal-cleanup-settlement.mjs") },
    { source: "mips-profile.mjs", file: path.join(paths.reaRoot, "dist/ida/liminal-mips-profile.mjs") },
    { source: "headless_health.py", file: path.join(paths.idaSitePackages, "ida_pro_mcp/ida_mcp/liminal_headless_health.py") },
  ];
  for (const helper of helperFiles) {
    // Stable installed bytes even when Git checked the repair sources out CRLF.
    const after = Buffer.from((await fs.readFile(path.join(helperRoot, helper.source), "utf8")).replaceAll("\r\n", "\n"));
    const before = await readOptional(helper.file);
    if (before && !before.equals(after)) throw new Error(`Unexpected existing compatibility helper: ${helper.file}`);
    files.push({ file: helper.file, before, after, changed: !before });
  }
  return { versions: { rea: pkg.version, idaMcp: "2.0.0" }, files };
}

export function publicPlan(plan) {
  return { versions: plan.versions, files: plan.files.map(({ file, before, after, backup, changed }) => ({
    file, status: changed ? "would change" : "already repaired", beforeSha256: before ? sha256(before) : null,
    afterSha256: sha256(after), ...(backup ? { backup } : {}),
  })) };
}

export function orderRepairWrites(files) {
  // Dependencies first: helpers, compatible call options, then importing session.
  const priority = entry => !entry.backup ? 0 : path.basename(entry.file) === "IdaProvider.js" ? 3 : path.basename(entry.file) === "IdaSessionClient.js" ? 2 : 1;
  return files.filter(file => file.changed).sort((a, b) => priority(a) - priority(b));
}

export async function applyRepair(plan) {
  const changed = orderRepairWrites(plan.files);
  // Complete all fingerprint and backup checks before the first source write.
  for (const entry of changed) {
    const current = await readOptional(entry.file);
    if ((current === null) !== (entry.before === null) || (current && !current.equals(entry.before))) throw new Error(`Backend changed since plan: ${entry.file}`);
    if (entry.backup) {
      const existing = await readOptional(entry.backup);
      if (existing && !existing.equals(entry.backupBytes ?? entry.before)) throw new Error(`Conflicting repair backup: ${entry.backup}`);
    }
  }
  for (const entry of changed.filter(entry => entry.backup)) {
    const original = entry.backupBytes ?? entry.before;
    try { await fs.writeFile(entry.backup, original, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !(await fs.readFile(entry.backup)).equals(original)) throw error; }
  }
  const written = [];
  try {
    for (const entry of changed) {
      const temporary = entry.file + ".liminal-repair-" + randomUUID();
      try {
        await fs.writeFile(temporary, entry.after, { flag: "wx" });
        const current = await readOptional(entry.file);
        if ((current === null) !== (entry.before === null) || (current && !current.equals(entry.before))) throw new Error(`Backend changed during apply: ${entry.file}`);
        await fs.rename(temporary, entry.file); written.push(entry);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    for (const entry of written) if (!(await fs.readFile(entry.file)).equals(entry.after)) throw new Error(`Repair verification failed: ${entry.file}`);
  } catch (error) {
    const failures = [];
    for (const entry of written.reverse()) {
      try {
        if (entry.before === null) await fs.unlink(entry.file);
        else await fs.writeFile(entry.file, entry.before);
      } catch (rollbackError) { failures.push(`${entry.file}: ${rollbackError.message}`); }
    }
    if (failures.length) throw new Error(`${error.message}; rollback incomplete: ${failures.join("; ")}`, { cause: error });
    throw error;
  }
  return changed.length;
}

async function main() {
  const args = process.argv.slice(2);
  const paths = {
    reaRoot: path.join(os.homedir(), ".local/share/rea/app/node_modules/rea-agents"),
    idaSitePackages: path.join(os.homedir(), ".local/share/rea/ida-venv/Lib/site-packages"),
  };
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--dry-run") { /* default */ }
    else if (args[i] === "--rea-root" && args[i + 1]) paths.reaRoot = args[++i];
    else if (args[i] === "--ida-site-packages" && args[i + 1]) paths.idaSitePackages = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  const plan = await planRepair(paths);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...publicPlan(plan) }, null, 2));
  if (apply) console.log(JSON.stringify({ changedFiles: await applyRepair(plan) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
