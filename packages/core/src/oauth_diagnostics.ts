import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { globalPath } from "./global_storage.js";

/** Count encrypted OAuth account files on disk (even when decrypt fails). */
export async function countOAuthAccountFiles(provider: string): Promise<number> {
  const dir = globalPath("oauth", provider.replace(/[^a-z0-9_-]/gi, "_"));
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export function oauthDecryptHint(provider: string): string {
  const homeEnv = path.join(homedir(), ".liminal", ".env");
  return (
    `Found ${provider} OAuth file(s) under ~/.liminal/oauth/ but could not decrypt them in this process. ` +
    `Reconnect once in Settings → Integrations (tokens will re-encrypt with the stable device key). ` +
    `If reconnect also fails, ensure \`liminald/repo/.env\` or ${homeEnv} contains the same ` +
    `AGENT_API_KEY used when you first connected, or set AGENT_OAUTH_ENCRYPTION_KEY.`
  );
}
