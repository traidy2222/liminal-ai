import { spawnSync } from "node:child_process";

/** Same detection as `run-web.mjs` so `web` and `web:dev` behave consistently. */
const bootstrapFlag =
  process.argv.includes("--bootstrap") || process.env["npm_config_bootstrap"] === "true";
const yoloFlag = process.argv.includes("--yolo") || process.env["npm_config_yolo"] === "true";

const env = {
  ...process.env,
  ...(bootstrapFlag ? { AGENT_PERSONA_BOOTSTRAP_FORCE: "1" } : {}),
  ...(yoloFlag ? { AGENT_YOLO: "1" } : {}),
};

const result = spawnSync("npm", ["run", "dev", "--workspace=packages/web"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

process.exit(result.status ?? 1);
