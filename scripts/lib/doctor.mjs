import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  API_KEY_VARS,
  firstApiKey,
  readEnvFile,
  resolvePort,
} from "./envWriter.mjs";
import { log, printHeader } from "./log.mjs";
import {
  coreDistMain,
  envPath,
  resolveRepoRoot,
  toolsDistDir,
  webClientDistIndex,
} from "./paths.mjs";
import { checkGit, checkNode, checkNpm } from "./preflight.mjs";

/**
 * @typedef {{ name: string; ok: boolean; required: boolean; message: string; hint?: string }} CheckResult
 */

/**
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * @param {{ repoRoot?: string; quiet?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean; results: CheckResult[] }>}
 */
export async function runDoctor(opts = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const quiet = opts.quiet ?? false;
  /** @type {CheckResult[]} */
  const results = [];

  const push = (result) => {
    results.push(result);
    if (!quiet) {
      const tag = result.ok ? "ok" : result.required ? "error" : "warn";
      log(tag, `${result.name}: ${result.message}`);
      if (!result.ok && result.hint) {
        log("info", `  → ${result.hint}`);
      }
    }
  };

  if (!quiet) {
    printHeader("liminal doctor");
  }

  const node = checkNode();
  push({
    name: "Node.js",
    ok: node.ok,
    required: true,
    message: node.ok ? node.version : node.message,
    hint: node.ok ? undefined : "https://nodejs.org/",
  });

  const npm = checkNpm();
  push({
    name: "npm",
    ok: npm.ok,
    required: true,
    message: npm.ok ? npm.version : npm.message,
  });

  const git = checkGit();
  push({
    name: "git",
    ok: git.ok,
    required: false,
    message: "optional" in git && git.optional ? git.message : "available",
  });

  const repoOk = fs.existsSync(path.join(repoRoot, "package.json"));
  push({
    name: "Install directory",
    ok: repoOk,
    required: true,
    message: repoOk ? repoRoot : `Not found: ${repoRoot}`,
    hint: repoOk ? undefined : "Re-run install or set LIMINAL_INSTALL_DIR",
  });

  const envFile = envPath(repoRoot);
  const env = readEnvFile(envFile);
  const apiKey = firstApiKey(env);
  push({
    name: "API key",
    ok: Boolean(apiKey),
    required: true,
    message: apiKey ? "configured" : `.env missing or no ${API_KEY_VARS.join(" / ")}`,
    hint: apiKey ? undefined : "Run: liminal setup",
  });

  const coreMain = coreDistMain(repoRoot);
  push({
    name: "core build",
    ok: fs.existsSync(coreMain),
    required: true,
    message: fs.existsSync(coreMain) ? coreMain : "packages/core/dist missing",
    hint: fs.existsSync(coreMain) ? undefined : "Run: npm run build -w packages/core",
  });

  const toolsDist = toolsDistDir(repoRoot);
  const toolsOk = fs.existsSync(path.join(toolsDist, "index.js"));
  push({
    name: "tools build",
    ok: toolsOk,
    required: true,
    message: toolsOk ? toolsDist : "packages/tools/dist missing",
    hint: toolsOk ? undefined : "Run: npm run build -w packages/tools",
  });

  const webClient = webClientDistIndex(repoRoot);
  push({
    name: "web client build",
    ok: fs.existsSync(webClient),
    required: false,
    message: fs.existsSync(webClient) ? webClient : "packages/web/client/dist missing (built on `liminal web`)",
    hint: fs.existsSync(webClient) ? undefined : "Run: npm run build:client -w packages/web",
  });

  const port = resolvePort(env);
  const portFree = await isPortFree(port);
  push({
    name: `Port ${port}`,
    ok: portFree,
    required: false,
    message: portFree ? "available" : "in use (another Liminal instance may be running)",
    hint: portFree ? undefined : `Set PORT in .env or stop the process on ${port}`,
  });

  push({
    name: "Playwright chromium",
    ok: true,
    required: false,
    message: "optional — run npm run browser:install for headless browser tools",
  });

  const failed = results.some((r) => r.required && !r.ok);
  if (!quiet) {
    console.log("");
    if (failed) {
      log("error", "Doctor found required issues. Fix the items above and re-run `liminal doctor`.");
    } else {
      log("ok", "All required checks passed.");
    }
  }

  return { ok: !failed, results };
}
