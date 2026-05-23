import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  API_KEY_VARS,
  firstApiKey,
  readEnvFile,
  resolvePort,
  writeEnvMerge,
} from "./envWriter.mjs";
import { log, printHeader } from "./log.mjs";
import {
  coreDistMain,
  envExamplePath,
  envPath,
  resolveRepoRoot,
  toolsDistDir,
} from "./paths.mjs";
import { runPreflight } from "./preflight.mjs";
import { PROVIDER_PRESETS, presetByIndex } from "./providerPresets.mjs";
import { needsBuild, needsInstall, runNpm } from "./run.mjs";

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} prompt
 * @param {string} [defaultValue]
 */
async function ask(rl, prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || defaultValue;
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} prompt
 */
async function askSecret(rl, prompt) {
  process.stdout.write(`${prompt}: `);
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    return readMaskedSecret();
  }
  return (await rl.question("")).trim();
}

function readMaskedSecret() {
  return new Promise((resolve) => {
    /** @type {string[]} */
    const chars = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (/** @type {string} */ chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(chars.join(""));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write("\b \b");
          }
          continue;
        }
        chars.push(ch);
        process.stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

/**
 * @param {string} baseURL
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean; message: string }>}
 */
async function smokeTestProvider(baseURL, apiKey) {
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { ok: true, message: `Provider reachable (${res.status})` };
    }
    return { ok: false, message: `Provider returned ${res.status} ${res.statusText}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runSetup(argv) {
  const flags = parseSetupFlags(argv);
  const repoRoot = resolveRepoRoot();
  printHeader("liminal setup");

  if (!runPreflight()) {
    return 1;
  }

  const dotEnv = envPath(repoRoot);
  const existing = readEnvFile(dotEnv);
  const hasKey = Boolean(firstApiKey(existing));

  if (flags.skipIfConfigured && hasKey && !flags.force) {
    log("ok", "API key already configured — skipping prompts (use --force to reconfigure).");
    return finishSetup(repoRoot, flags);
  }

  /** @type {Record<string, string>} */
  let updates = {};

  if (flags.nonInteractive) {
    const key =
      process.env.AGENT_API_KEY?.trim() ||
      API_KEY_VARS.map((k) => process.env[k]?.trim()).find(Boolean);
    if (!key) {
      log("error", "Non-interactive setup requires AGENT_API_KEY in the environment.");
      return 1;
    }
    updates = {
      AGENT_API_KEY: key,
      AGENT_API_BASE_URL:
        process.env.AGENT_API_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      AGENT_MODEL: process.env.AGENT_MODEL?.trim() || "deepseek/deepseek-chat",
    };
    if (process.env.PORT?.trim()) {
      updates.PORT = process.env.PORT.trim();
    }
    if (process.env.AGENT_WORKSPACE_ROOT?.trim()) {
      updates.AGENT_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT.trim();
    }
  } else {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("Choose a provider preset:\n");
      PROVIDER_PRESETS.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.label}`);
      });
      console.log("");

      const choiceRaw = await ask(rl, "Preset number", "1");
      const choice = Number.parseInt(choiceRaw, 10);
      const preset = presetByIndex(choice) ?? PROVIDER_PRESETS[0];

      let baseURL = preset.baseURL;
      let model = preset.model;
      let apiKey = preset.apiKey;

      if (preset.id === "custom") {
        baseURL = await ask(rl, "API base URL (…/v1)", "https://openrouter.ai/api/v1");
        model = await ask(rl, "Model id", "deepseek/deepseek-chat");
      }

      if (preset.needsKey) {
        if (preset.hint) {
          log("info", preset.hint);
        }
        const entered = await askSecret(rl, "API key");
        if (!entered.trim()) {
          log("error", "API key is required.");
          return 1;
        }
        apiKey = entered.trim();
      }

      const port = await ask(rl, "Web UI port", "3001");
      const workspace = await ask(rl, "Workspace root", repoRoot);

      updates = {
        AGENT_API_KEY: apiKey,
        AGENT_API_BASE_URL: baseURL,
        AGENT_MODEL: model,
        PORT: port,
        AGENT_WORKSPACE_ROOT: workspace,
      };
    } finally {
      rl.close();
    }
  }

  writeEnvMerge({
    envPath: dotEnv,
    examplePath: envExamplePath(repoRoot),
    updates,
  });
  log("ok", `Wrote ${dotEnv}`);

  return finishSetup(repoRoot, flags, updates);
}

/**
 * @param {string} repoRoot
 * @param {ReturnType<typeof parseSetupFlags>} flags
 * @param {Record<string, string>} [updates]
 */
async function finishSetup(repoRoot, flags, updates = {}) {
  if (flags.freshDeps || needsInstall(repoRoot)) {
    log("info", "Running npm install…");
    const code = runNpm(repoRoot, ["install"]);
    if (code !== 0) {
      return code;
    }
  }

  const coreMain = coreDistMain(repoRoot);
  const toolsDist = toolsDistDir(repoRoot);
  if (flags.forceBuild || needsBuild(repoRoot, { coreMain, toolsDist })) {
    log("info", "Running npm run build…");
    const code = runNpm(repoRoot, ["run", "build"]);
    if (code !== 0) {
      return code;
    }
  }

  const env = readEnvFile(envPath(repoRoot));
  const baseURL = updates.AGENT_API_BASE_URL || env.AGENT_API_BASE_URL || "";
  const apiKey = updates.AGENT_API_KEY || firstApiKey(env) || "";
  if (baseURL && apiKey) {
    const smoke = await smokeTestProvider(baseURL, apiKey);
    if (smoke.ok) {
      log("ok", smoke.message);
    } else {
      log("warn", `Provider smoke test failed: ${smoke.message}`);
    }
  }

  const port = resolvePort(env);
  console.log("");
  log("ok", "Setup complete.");
  console.log("");
  console.log("Next steps:");
  console.log(`  liminal web --bootstrap --open   # Web UI on http://127.0.0.1:${port}/`);
  console.log("  liminal tui --bootstrap          # Terminal UI");
  console.log("  liminal doctor                   # Verify install");
  console.log("");

  if (flags.launch) {
    const { runWeb } = await import("./commands/web.mjs");
    return runWeb(["--bootstrap", "--open"]);
  }

  return 0;
}

/** @param {string[]} argv */
function parseSetupFlags(argv) {
  return {
    skipIfConfigured: argv.includes("--skip-if-configured"),
    force: argv.includes("--force"),
    nonInteractive: argv.includes("--non-interactive"),
    freshDeps: argv.includes("--fresh-deps"),
    forceBuild: argv.includes("--force-build"),
    launch: argv.includes("--launch") && !argv.includes("--no-launch"),
    noLaunch: argv.includes("--no-launch"),
  };
}
