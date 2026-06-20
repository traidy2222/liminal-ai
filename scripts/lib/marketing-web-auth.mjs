/**
 * Loopback web API auth for marketing capture scripts (headless + live).
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * @returns {Promise<string | null>}
 */
export async function resolveWebAuthToken() {
  const fromEnv = process.env.AGENT_WEB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.LIMINAL_HOME?.trim() || path.join(os.homedir(), ".liminal");
  try {
    const token = (await readFile(path.join(home, "web_token"), "utf8")).trim();
    return token.length >= 16 ? token : null;
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} token
 */
export function webAuthHeaders(token) {
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
    "X-Liminal-Token": token,
  };
}

/**
 * @param {string} base
 */
export async function probeWebApi(base) {
  const url = base.replace(/\/$/, "");
  try {
    const cfg = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(5000) });
    if (cfg.ok) return true;
  } catch {
    /* fall through */
  }
  const token = await resolveWebAuthToken();
  if (!token) return false;
  try {
    const st = await fetch(`${url}/api/status`, {
      headers: webAuthHeaders(token),
      signal: AbortSignal.timeout(5000),
    });
    return st.ok;
  } catch {
    return false;
  }
}
