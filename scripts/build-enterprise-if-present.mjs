import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(new URL("../packages/enterprise/package.json", import.meta.url))) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "-w", "@liminal/enterprise"], {
    cwd: root, stdio: "inherit", shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.log("Community build complete; optional Enterprise package is not installed.");
}
