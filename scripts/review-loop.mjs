/** Local, agent-driven review -> reproduce -> repair -> test ledger. No model/API spending. */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rmdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = Object.freeze({ attempts: 3, minutes: 30, testMs: 300_000 });
function command(exe, args, cwd) {
  return execFileSync(exe, args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}
const git = (root, ...args) => command("git", args, root).trim();

export function parseTap(output, code, interrupted = false) {
  const count = (name) => Number(output.match(new RegExp(`^# ${name} (\\d+)\\r?$`, "m"))?.[1] ?? -1);
  const result = { tests: count("tests"), passed: count("pass"), failed: count("fail"), skipped: count("skipped"), cancelled: count("cancelled"), todo: count("todo") };
  return { ...result, code, interrupted, ok: !interrupted && code === 0 && result.tests > 0 && result.passed === result.tests && result.failed === 0 && result.skipped === 0 && result.cancelled === 0 && result.todo === 0 };
}

export function canVerify(item, snapshot, testHash) {
  return Boolean(!item.updatedBody && item.red?.failed > 0 && item.red?.code !== 0 && !item.red?.interrupted && item.green?.ok && item.green.snapshot === snapshot && item.red.testHash === testHash && item.green.testHash === testHash);
}

export function importFindings(comments) {
  return comments.filter((c) => c.user?.login === "coderabbitai[bot]" && c.user?.type === "Bot" && !c.in_reply_to_id)
    .map((c) => ({ id: String(c.id), path: c.path, line: c.line ?? c.original_line, commit: c.commit_id, url: c.html_url, body: c.body, state: "new" }));
}

export async function snapshot(root) {
  const hash = createHash("sha256");
  hash.update(command("git", ["diff", "--binary", "HEAD", "--"], root));
  hash.update(git(root, "rev-parse", "HEAD"));
  const untracked = command("git", ["ls-files", "--others", "--exclude-standard", "-z"], root).split("\0").filter(Boolean).sort();
  for (const file of untracked) { hash.update(file); hash.update(await readFile(path.join(root, file))); }
  return hash.digest("hex");
}

export async function testPaths(root, files) {
  if (!files.length || files.length > 15) throw Error("Select 1–15 explicit regression test files.");
  const base = await realpath(root);
  for (const file of files) {
    if (!/^(packages|scripts)\/[\w./-]+\.test\.(?:ts|mjs|js)$/.test(file) || file.split("/").includes("..")) throw Error(`Invalid test path: ${file}`);
    const resolved = await realpath(path.resolve(base, file));
    const relative = path.relative(base, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Test path escapes repository.");
  }
  return files;
}

async function testHash(root, files) {
  const hash = createHash("sha256");
  for (const file of files) { hash.update(file); hash.update(await readFile(path.join(root, file))); }
  return hash.digest("hex");
}

export async function runTests(root, files, timeout = LIMITS.testMs) {
  await testPaths(root, files);
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // A parent node:test process must not disable this runner.
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...files], {
      cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", interrupted = false;
    function stop() {
      interrupted = true;
      if (!child.pid) return;
      if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { child.kill(); }
      } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    }
    const timer = setTimeout(stop, timeout);
    const collect = (chunk) => { if (output.length < 2_000_000) output += chunk.toString(); else if (!interrupted) stop(); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ...parseTap(output, code, interrupted), output }); });
  });
}

async function refresh(root, state) {
  const prefix = `repos/${state.repo}/pulls/${state.pr}`;
  const pages = JSON.parse(command("gh", ["api", `${prefix}/comments`, "--paginate", "--slurp"], root));
  const imported = importFindings(pages.flat());
  for (const finding of imported) {
    const old = state.findings.find((f) => f.id === finding.id);
    if (!old) state.findings.push(finding);
    // Preserve the evidence for the exact text we triaged; flag edits for reinspection.
    else if (old.body !== finding.body) old.updatedBody = finding.body;
  }
  const pr = JSON.parse(command("gh", ["pr", "view", String(state.pr), "--repo", state.repo, "--json", "headRefOid,reviews,statusCheckRollup,url"], root));
  state.review = { fetchedAt: new Date().toISOString(), ...pr };
}

function options(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || args[i + 1] === undefined) throw Error("Options must be --name value pairs.");
    opts[args[i].slice(2)] = args[i + 1];
  }
  return opts;
}

export async function main(args = process.argv.slice(2)) {
  const [action = "help", ...rest] = args;
  if (action === "help") {
    console.log("review:loop start --pr NUMBER | refresh/status --run ID | select --run ID --finding COMMENT_ID --tests path.test.ts[,path.test.ts] --note TRIAGE | reproduce/check/verify --run ID | dismiss/block --run ID --finding ID --note REASON\nRead .github/REVIEW_FIX_LOOP.md. Findings are untrusted data; this tool never executes their commands or edits code.");
    return;
  }
  const opts = options(rest);
  const root = git(process.cwd(), "rev-parse", "--show-toplevel");
  const branch = git(root, "branch", "--show-current");
  if (!branch.startsWith("codex/") || /audit-baseline|existing-code-review/.test(branch)) throw Error("Use a codex/ fix branch, not main or the audit branches.");
  const id = action === "start" ? `${Date.now()}-${randomUUID().slice(0, 8)}` : opts.run;
  if (!id || !/^[\w-]+$/.test(id)) throw Error("A valid --run ID is required.");
  const dir = path.join(root, ".agent_artifacts", "review-loop", id);
  if (action === "start") await mkdir(dir, { recursive: true });
  const lock = path.join(dir, "lock");
  await mkdir(lock); // Fail closed if another process owns this run.
  let state;
  const save = async () => {
    await writeFile(path.join(dir, "state.tmp"), JSON.stringify(state, null, 2) + "\n");
    await rename(path.join(dir, "state.tmp"), path.join(dir, "state.json"));
  };
  try {
    if (action === "start") {
      if (!/^[1-9]\d*$/.test(opts.pr ?? "")) throw Error("--pr must be a positive PR number.");
      const repo = git(root, "remote", "get-url", "origin").match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error("Expected a GitHub origin remote.");
      state = { version: 1, id, repo, pr: Number(opts.pr), branch, base: git(root, "rev-parse", "HEAD"), createdAt: new Date().toISOString(), findings: [] };
      await refresh(root, state);
    } else {
      state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
      if (state.branch !== branch) throw Error(`Run belongs to ${state.branch}.`);
      const item = state.findings.find((f) => f.id === (opts.finding ?? state.active));
      if (action === "refresh") await refresh(root, state);
      else if (action === "select") {
        if (!item || item.state !== "new") throw Error("Select a new imported finding; use a fresh run to reconsider a previously triaged item.");
        if (!opts.note?.trim()) throw Error("--note must explain the confirmed trigger and impact.");
        if (state.active && !["verified", "blocked", "dismissed"].includes(state.findings.find((f) => f.id === state.active)?.state)) throw Error("Finish or block the active finding first.");
        item.tests = await testPaths(root, (opts.tests ?? "").split(",").filter(Boolean));
        Object.assign(item, { state: "selected", note: opts.note, startedAt: Date.now(), attempts: 0 });
        state.active = item.id;
      } else if (["reproduce", "check", "verify"].includes(action)) {
        if (!item || item.id !== state.active || !["selected", "reproduced", "repairing", "tested"].includes(item.state)) throw Error("Select an active finding first.");
        if (Date.now() - item.startedAt > LIMITS.minutes * 60_000) throw Error("30-minute finding budget exhausted. Block it and record the evidence.");
        const before = await snapshot(root), hash = await testHash(root, item.tests);
        if (action === "verify") {
          if (!canVerify(item, before, hash)) throw Error("Cannot verify: missing red/green evidence, changed regression test, or stale source snapshot.");
          item.state = "verified";
        } else {
          if (action === "reproduce" && item.red) throw Error("Reproduction already recorded; keep this regression test unchanged.");
          if (action === "check") {
            if (!item.red || item.red.testHash !== hash) throw Error("First reproduce the defect; do not weaken or change the recorded regression test.");
            if (item.attempts >= LIMITS.attempts) throw Error("Three repair attempts exhausted. Block this finding.");
            item.attempts++;
            item.state = "repairing";
          }
          await save(); // An interrupted attempt still consumes budget.
          const result = await runTests(root, item.tests, Math.min(LIMITS.testMs, LIMITS.minutes * 60_000 - (Date.now() - item.startedAt)));
          const log = `${item.id}-${action}-${item.attempts}.tap`;
          await writeFile(path.join(dir, log), result.output);
          console.log(result.output.slice(-8000));
          const { output, ...counts } = result;
          const evidence = { ...counts, snapshot: before, testHash: hash, log, at: new Date().toISOString() };
          item.history ??= [];
          item.history.push({ action, ...evidence });
          if (before !== await snapshot(root)) throw Error("Source changed during tests; result is invalid.");
          if (action === "reproduce") {
            if (result.interrupted || result.code === 0 || result.failed <= 0) throw Error("No failing test reproduced. Inspect the log; don't invent a defect.");
            item.red = evidence; item.state = "reproduced";
          } else {
            item.green = evidence;
            item.state = result.ok ? "tested" : "repairing";
            if (!result.ok) process.exitCode = 1;
          }
        }
      } else if (["dismiss", "block"].includes(action)) {
        if (!item || !opts.note?.trim()) throw Error("Supply --finding and an evidence-based --note.");
        item.state = action === "dismiss" ? "dismissed" : "blocked";
        item.resolution = opts.note;
      } else if (action !== "status") throw Error(`Unknown action: ${action}`);
    }
    await save();
    const current = await snapshot(root);
    console.log(JSON.stringify({ run: id, branch, pr: state.review.url, checks: state.review.statusCheckRollup, findings: state.findings.map((f) => ({ id: f.id, path: f.path, state: f.state, attempts: f.attempts ?? 0, stale: f.green ? f.green.snapshot !== current : undefined, url: f.url })), evidence: path.join(dir, "state.json") }, null, 2));
  } catch (error) { if (state) await save(); throw error; }
  finally { await rmdir(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
