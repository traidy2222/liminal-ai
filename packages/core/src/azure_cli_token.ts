/**
 * Optional Azure CLI credential bridge — uses `az account get-access-token` when logged in.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function tryAzCliArmAccessToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "az.cmd" : "az",
      ["account", "get-access-token", "--resource", "https://management.azure.com", "--output", "json"],
      { timeout: 20_000, windowsHide: true }
    );
    const parsed = JSON.parse(stdout) as { accessToken?: string; expiresOn?: string };
    if (!parsed.accessToken?.trim()) return null;
    return parsed.accessToken.trim();
  } catch {
    return null;
  }
}
