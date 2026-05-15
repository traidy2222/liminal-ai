import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import {
  pickObsidianVaultFromParsedConfig,
  candidateObsidianJsonPaths,
  validateVaultDirectory,
} from "./obsidian_vault_discovery.js";

const optsNoDot = { requireDotObsidian: false } as const;

test("pickObsidianVaultFromParsedConfig: empty / no vaults", () => {
  assert.equal(pickObsidianVaultFromParsedConfig({}, optsNoDot), undefined);
  assert.equal(pickObsidianVaultFromParsedConfig({ vaults: {} }, optsNoDot), undefined);
  assert.equal(pickObsidianVaultFromParsedConfig({ vaults: { a: { foo: 1 } } }, optsNoDot), undefined);
});

test("pickObsidianVaultFromParsedConfig: single vault", () => {
  const parsed = {
    vaults: {
      id1: { path: "/home/user/VaultOne", ts: 100 },
    },
  };
  assert.equal(pickObsidianVaultFromParsedConfig(parsed, optsNoDot), normalize("/home/user/VaultOne"));
});

test("pickObsidianVaultFromParsedConfig: two vaults, exactly one open", () => {
  const parsed = {
    vaults: {
      a: { path: "/x/Old", ts: 200, open: false },
      b: { path: "/x/Current", ts: 100, open: true },
    },
  };
  assert.equal(pickObsidianVaultFromParsedConfig(parsed, optsNoDot), normalize("/x/Current"));
});

test("pickObsidianVaultFromParsedConfig: two open true is ambiguous", () => {
  const parsed = {
    vaults: {
      a: { path: "/x/A", open: true },
      b: { path: "/x/B", open: true },
    },
  };
  assert.equal(pickObsidianVaultFromParsedConfig(parsed, optsNoDot), undefined);
});

test("pickObsidianVaultFromParsedConfig: latest ts wins when unique", () => {
  const parsed = {
    vaults: {
      a: { path: "/x/Older", ts: 100 },
      b: { path: "/x/Newer", ts: 300 },
    },
  };
  assert.equal(pickObsidianVaultFromParsedConfig(parsed, optsNoDot), normalize("/x/Newer"));
});

test("pickObsidianVaultFromParsedConfig: tie on ts is ambiguous", () => {
  const parsed = {
    vaults: {
      a: { path: "/x/A", ts: 100 },
      b: { path: "/x/B", ts: 100 },
    },
  };
  assert.equal(pickObsidianVaultFromParsedConfig(parsed, optsNoDot), undefined);
});

test("pickObsidianVaultFromParsedConfig: nameSubstring filter", () => {
  const parsed = {
    vaults: {
      a: { path: "/projects/foo", ts: 999 },
      b: { path: "/projects/bar-vault", ts: 1 },
    },
  };
  assert.equal(
    pickObsidianVaultFromParsedConfig(parsed, { ...optsNoDot, nameSubstring: "bar-vault" }),
    normalize("/projects/bar-vault")
  );
});

test("pickObsidianVaultFromParsedConfig: nameSubstring no match", () => {
  const parsed = {
    vaults: {
      a: { path: "/x/A", ts: 100 },
    },
  };
  assert.equal(
    pickObsidianVaultFromParsedConfig(parsed, { ...optsNoDot, nameSubstring: "nomatch" }),
    undefined
  );
});

test("candidateObsidianJsonPaths returns non-empty on all platforms", () => {
  const paths = candidateObsidianJsonPaths();
  assert.ok(paths.length >= 1);
  assert.ok(paths.every((p) => typeof p === "string" && p.length > 0));
});

test("validateVaultDirectory: directory without .obsidian when required", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-vault-"));
  try {
    assert.equal(validateVaultDirectory(dir, true), false);
    assert.equal(validateVaultDirectory(dir, false), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateVaultDirectory: directory with .obsidian passes when required", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-vault-"));
  try {
    mkdirSync(join(dir, ".obsidian"));
    assert.equal(validateVaultDirectory(dir, true), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
