import { spawnSync } from "node:child_process";

const bootstrapFlag =
  process.argv.includes("--bootstrap") || process.env["npm_config_bootstrap"] === "true";

const env = {
  ...process.env,
  ...(bootstrapFlag ? { AGENT_PERSONA_BOOTSTRAP_FORCE: "1" } : {}),
};

const run = (args) => {
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  return result.status ?? 1;
};

const buildExit = run(["run", "build:client", "--workspace=packages/web"]);
if (buildExit !== 0) {
  process.exit(buildExit);
}

const startExit = run(["run", "start", "--workspace=packages/web"]);
process.exit(startExit);
