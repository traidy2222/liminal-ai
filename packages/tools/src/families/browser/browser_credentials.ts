import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { protectLocalSecret, unprotectLocalSecret } from "@liminal/core";
import { browserProfileRoot } from "./browser_profile.js";

type SavedLogin = { id: string; origin: string; username: string; encryptedPassword: string; createdAt: number };
function directory(): string { return path.join(browserProfileRoot(), "credentials"); }
function safeOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) {
    throw new Error("Saved logins require HTTPS (or a local test server)");
  }
  return parsed.origin;
}
export function savedBrowserLogins(url: string) {
  const origin = safeOrigin(url);
  if (!fs.existsSync(directory())) return [];
  return fs.readdirSync(directory()).filter(f => /^[a-f0-9-]+\.json$/.test(f)).flatMap(file => {
    try { const data = JSON.parse(fs.readFileSync(path.join(directory(), file), "utf8")) as SavedLogin;
      return data.origin === origin ? [{ id: data.id, origin, username: data.username, createdAt: data.createdAt }] : [];
    } catch { return []; }
  });
}
export function prepareBrowserLogin(url: string, username: string) {
  const origin = safeOrigin(url);
  if (!username.trim()) throw new Error("A username is required before preparing a login");
  const existing = savedBrowserLogins(url).find(login => login.username === username);
  if (existing) return existing;
  const login: SavedLogin = { id: randomUUID(), origin, username, createdAt: Date.now(),
    encryptedPassword: protectLocalSecret(randomBytes(24).toString("base64url") + "aA1!") };
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory(), `${login.id}.json`), JSON.stringify(login), { mode: 0o600, flag: "wx" });
  return { id: login.id, origin, username, createdAt: login.createdAt };
}
/** Only browser runtime may use the returned secret. Never return it as a tool result. */
export function readBrowserLoginForFill(url: string, id: string): { username: string; password: string } {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid saved login id");
  const login = JSON.parse(fs.readFileSync(path.join(directory(), `${id}.json`), "utf8")) as SavedLogin;
  if (login.origin !== safeOrigin(url)) throw new Error("Saved login belongs to a different origin; navigate to its actual sign-in site");
  return { username: login.username, password: unprotectLocalSecret(login.encryptedPassword) };
}
