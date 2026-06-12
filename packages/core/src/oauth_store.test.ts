import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  __resetOAuthStoreEnvPrimedForTests,
  listOAuthAccounts,
  writeOAuthBundle,
  type OAuthTokenBundle,
} from "./oauth_store.js";

function legacyEncrypt(plain: string, apiKey: string): string {
  const key = createHash("sha256").update(apiKey.slice(0, 32)).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

describe("oauth_store", () => {
  let prevGlobalRoot: string | undefined;
  let prevApiKey: string | undefined;
  let prevRepoRoot: string | undefined;
  let tempDir = "";

  beforeEach(() => {
    __resetOAuthStoreEnvPrimedForTests();
    prevGlobalRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
    prevApiKey = process.env.AGENT_API_KEY;
    prevRepoRoot = process.env.LIMINAL_REPO_ROOT;
    tempDir = mkdtempSync(join(tmpdir(), "liminal-oauth-test-"));
    process.env.AGENT_GLOBAL_STORAGE_ROOT = tempDir;
  });

  afterEach(() => {
    __resetOAuthStoreEnvPrimedForTests();
    if (prevGlobalRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
    else process.env.AGENT_GLOBAL_STORAGE_ROOT = prevGlobalRoot;
    if (prevApiKey === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = prevApiKey;
    if (prevRepoRoot === undefined) delete process.env.LIMINAL_REPO_ROOT;
    else process.env.LIMINAL_REPO_ROOT = prevRepoRoot;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("decrypts legacy API-key blobs via .env without process AGENT_API_KEY", async () => {
    const apiKey = "legacy-test-api-key-32chars!!!!";
    const repoDir = mkdtempSync(join(tempDir, "repo-"));
    writeFileSync(join(repoDir, ".env"), `AGENT_API_KEY=${apiKey}\n`, "utf8");
    process.env.LIMINAL_REPO_ROOT = repoDir;
    delete process.env.AGENT_API_KEY;

    const bundle: OAuthTokenBundle = {
      provider: "xero",
      accountId: "user@example.com",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const oauthDir = join(tempDir, "oauth", "xero");
    mkdirSync(oauthDir, { recursive: true });
    writeFileSync(
      join(oauthDir, "user_example_com.json"),
      legacyEncrypt(JSON.stringify(bundle), apiKey),
      "utf8"
    );

    const accounts = await listOAuthAccounts("xero");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.refreshToken, "refresh");
  });

  it("persists new writes with device key when AGENT_API_KEY is unset", async () => {
    delete process.env.AGENT_API_KEY;
    const bundle: OAuthTokenBundle = {
      provider: "xero",
      accountId: "stable@example.com",
      accessToken: "access2",
      refreshToken: "refresh2",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await writeOAuthBundle(bundle);

    __resetOAuthStoreEnvPrimedForTests();
    const accounts = await listOAuthAccounts("xero");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.accessToken, "access2");
  });
});
