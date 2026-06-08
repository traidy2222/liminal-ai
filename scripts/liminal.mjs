#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runDoctor } from "./lib/doctor.mjs";
import { log } from "./lib/log.mjs";
import { getDefaultInstallDir, resolveRepoRoot } from "./lib/paths.mjs";
import { runSetup } from "./lib/setup.mjs";
import { runTui, runUpdate, runWeb } from "./lib/commands/web.mjs";
import { loadEnvForCli } from "./lib/load-env.mjs";
import { runConnectGoogleCli } from "./lib/google-connect.mjs";
import { runHostedConnectCli, HOSTED_CONNECT_TARGETS } from "./lib/hosted-connect.mjs";
import { runHostedDisconnectCli, HOSTED_DISCONNECT_TARGETS } from "./lib/hosted-disconnect.mjs";

const USAGE = `Liminal — one-command setup and launcher

Usage:
  liminal setup [options]     Interactive first-run wizard (writes .env, install, build)
  liminal doctor              Verify Node, build artifacts, API key, port
  liminal web [options]       Start web UI (production — same as customers)
  liminal tui [options]       Start terminal UI
  liminal update              git pull + npm install + build (also runs before web/tui)
  liminal login               Sign in to Vireon (browser); saves license to ~/.liminal/
  liminal logout              Remove local Vireon account + license cache
  liminal connect google      Google OAuth (+ use --attach for MCP tools in one step)
  liminal connect <provider>  Hosted OAuth: ${HOSTED_CONNECT_TARGETS.join(", ")} (--read-only optional)
  liminal disconnect google   Revoke Google OAuth tokens
  liminal disconnect <provider> Revoke hosted OAuth: ${HOSTED_DISCONNECT_TARGETS.join(", ")}
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
  --dev                       Web dev mode (Vite HMR — not the customer path)
  --yolo                      Disable approval gates (trusted env only)
  --no-update                 Skip auto sync (pull/install/build) before launch
  --no-pull                   Sync without git pull (still install + build)
  --no-install                Sync without npm install
  --no-build                  Sync without npm run build

Before web/tui, liminal runs: git pull --ff-only (if tree clean) → npm install → npm run build.
Commit and push your changes, then rerun so pull picks up the latest remote (or skip pull with --no-pull when iterating locally).

Env: LIMINAL_SKIP_UPDATE=1 or LIMINAL_AUTO_UPDATE=0 disables auto sync.
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
    case "login": {
      const { spawn } = await import("node:child_process");
      const script = fileURLToPath(new URL("./lib/vireon-login.mjs", import.meta.url));
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [script], { stdio: "inherit", cwd: process.cwd() });
        child.on("exit", (code) => resolve(code ?? 1));
      });
    }
    case "logout": {
      const coreUrl = new URL("../packages/core/dist/vireon_account.js", import.meta.url).href;
      try {
        const { clearVireonAccount } = await import(coreUrl);
        await clearVireonAccount();
        console.log("Removed ~/.liminal/account.json and license cache.");
        return 0;
      } catch {
        console.error("Build core first: npm run build -w packages/core");
        return 1;
      }
    }
    case "connect": {
      const sub = rest[0];
      if (!sub) {
        log("error", "Usage: liminal connect <google|slack|linear|stripe|xero|github>");
        return 1;
      }
      loadEnvForCli();
      if (sub === "google") {
        return runConnectGoogleCli(rest.slice(1));
      }
      if (HOSTED_CONNECT_TARGETS.includes(sub)) {
        return runHostedConnectCli(sub, rest.slice(1));
      }
      log("error", `Unknown connect target: ${sub}. Try: google, ${HOSTED_CONNECT_TARGETS.join(", ")}`);
      return 1;
    }
    case "disconnect": {
      const sub = rest[0];
      if (!sub) {
        log("error", "Usage: liminal disconnect <google|slack|linear|stripe|xero|github>");
        return 1;
      }
      loadEnvForCli();
      if (sub === "google") {
        const { spawn } = await import("node:child_process");
        const script = fileURLToPath(new URL("./lib/google-disconnect.mjs", import.meta.url));
        return new Promise((resolve) => {
          const child = spawn(process.execPath, [script], { stdio: "inherit", cwd: process.cwd() });
          child.on("exit", (code) => resolve(code ?? 1));
        });
      }
      if (HOSTED_DISCONNECT_TARGETS.includes(sub)) {
        return runHostedDisconnectCli(sub);
      }
      log("error", `Unknown disconnect target: ${sub}. Try: google, ${HOSTED_DISCONNECT_TARGETS.join(", ")}`);
      return 1;
    }
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
