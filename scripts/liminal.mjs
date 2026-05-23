#!/usr/bin/env node
import { runDoctor } from "./lib/doctor.mjs";
import { log } from "./lib/log.mjs";
import { getDefaultInstallDir, resolveRepoRoot } from "./lib/paths.mjs";
import { runSetup } from "./lib/setup.mjs";
import { runTui, runUpdate, runWeb } from "./lib/commands/web.mjs";

const USAGE = `Liminal — one-command setup and launcher

Usage:
  liminal setup [options]     Interactive first-run wizard (writes .env, install, build)
  liminal doctor              Verify Node, build artifacts, API key, port
  liminal web [options]       Start web UI (production build)
  liminal tui [options]       Start terminal UI
  liminal update              git pull + npm install + build
  liminal path                Print install directory

Setup options:
  --skip-if-configured        Skip prompts when API key exists
  --force                     Re-run setup prompts
  --non-interactive           Use AGENT_API_KEY env (CI / install scripts)
  --fresh-deps                Always run npm install
  --force-build               Always run npm run build
  --launch                    Start web after setup
  --no-launch                 Do not auto-launch web

Web / TUI options:
  --bootstrap                 Force persona bootstrap modal
  --open                      Open browser when web server is ready
  --dev                       Web dev mode (Vite HMR + API)
  --yolo                      Disable approval gates (trusted env only)
`;

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "setup":
      return runSetup(rest);
    case "doctor": {
      const { ok } = await runDoctor();
      return ok ? 0 : 1;
    }
    case "web":
      return runWeb(rest);
    case "tui":
      return runTui(rest);
    case "update":
      return runUpdate();
    case "path": {
      console.log(resolveRepoRoot());
      console.log(`default install: ${getDefaultInstallDir()}`);
      return 0;
    }
    default:
      log("error", `Unknown command: ${command}`);
      console.log(USAGE);
      return 1;
  }
}

const args = process.argv.slice(2);
main(args).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
