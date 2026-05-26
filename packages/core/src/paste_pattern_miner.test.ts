import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  minePatternsFromSessions,
  isSpeculatable,
  DEFAULT_CONTEXT_WINDOW,
} from "./paste_pattern_miner.js";

function tcEvent(turnIndex: number, name: string, ok = true): string {
  return JSON.stringify({
    ts: "2026-05-26T07:00:00.000Z",
    event: "tool_result",
    turnIndex,
    name,
    ok,
  });
}

async function makeSessionsRoot(
  files: Array<{ chat: string; lines: string[] }>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "paste-mine-"));
  for (const f of files) {
    const dir = path.join(root, f.chat);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "session.jsonl"), f.lines.join("\n") + "\n", "utf8");
  }
  return root;
}

test("isSpeculatable blocks side-effecting tools", () => {
  assert.equal(isSpeculatable("web_fetch"), true);
  assert.equal(isSpeculatable("read_file"), true);
  assert.equal(isSpeculatable("write_file"), false);
  assert.equal(isSpeculatable("run_shell"), false);
  assert.equal(isSpeculatable("git_commit"), false);
  assert.equal(isSpeculatable("vault_write"), false);
});

test("miner extracts (web_search → web_fetch) at high probability", async () => {
  const root = await makeSessionsRoot([
    {
      chat: "chat_a",
      lines: [
        // Turn 1 — web_search,web_search → web_fetch (3 times)
        tcEvent(1, "recall_relevant"),
        tcEvent(1, "web_search"),
        tcEvent(1, "web_search"),
        tcEvent(1, "web_fetch"),
        tcEvent(1, "web_fetch"),
        tcEvent(1, "web_fetch"),
      ],
    },
    {
      chat: "chat_b",
      lines: [
        tcEvent(1, "web_search"),
        tcEvent(1, "web_search"),
        tcEvent(1, "web_fetch"),
        tcEvent(1, "web_fetch"),
      ],
    },
    {
      chat: "chat_c",
      lines: [
        tcEvent(1, "web_search"),
        tcEvent(1, "web_search"),
        tcEvent(1, "web_fetch"),
        tcEvent(1, "web_fetch"),
      ],
    },
  ]);
  try {
    const patterns = await minePatternsFromSessions({
      roots: [root],
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      minSupport: 3,
    });
    const wsToWf = patterns.find(
      (p) => p.contextKey === "web_search,web_search" && p.nextTool === "web_fetch"
    );
    assert.ok(wsToWf, "expected web_search,web_search → web_fetch pattern");
    assert.ok(wsToWf!.probability >= 0.5, `prob too low: ${wsToWf!.probability}`);
    assert.ok(wsToWf!.support >= 3, `support too low: ${wsToWf!.support}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("miner drops patterns below minSupport", async () => {
  const root = await makeSessionsRoot([
    {
      chat: "only",
      lines: [
        tcEvent(1, "read_file"),
        tcEvent(1, "grep_file"),
        tcEvent(1, "read_file"),
      ],
    },
  ]);
  try {
    const patterns = await minePatternsFromSessions({
      roots: [root],
      contextWindow: 2,
      minSupport: 5,
    });
    assert.equal(patterns.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("miner excludes side-effecting nextTool predictions", async () => {
  const root = await makeSessionsRoot([
    {
      chat: "side",
      lines: [
        tcEvent(1, "read_file"),
        tcEvent(1, "read_file"),
        tcEvent(1, "write_file"),
        tcEvent(1, "read_file"),
        tcEvent(1, "read_file"),
        tcEvent(1, "write_file"),
        tcEvent(1, "read_file"),
        tcEvent(1, "read_file"),
        tcEvent(1, "write_file"),
      ],
    },
  ]);
  try {
    const patterns = await minePatternsFromSessions({
      roots: [root],
      contextWindow: 2,
      minSupport: 2,
    });
    assert.equal(
      patterns.some((p) => p.nextTool === "write_file"),
      false,
      "write_file must never be predicted"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("miner ignores failed tool calls", async () => {
  const root = await makeSessionsRoot([
    {
      chat: "fails",
      lines: [
        tcEvent(1, "web_search"),
        tcEvent(1, "web_search"),
        tcEvent(1, "web_fetch", false),
        tcEvent(1, "web_fetch", false),
        tcEvent(1, "web_fetch", false),
      ],
    },
  ]);
  try {
    const patterns = await minePatternsFromSessions({
      roots: [root],
      contextWindow: 2,
      minSupport: 1,
    });
    assert.equal(
      patterns.some((p) => p.nextTool === "web_fetch"),
      false,
      "failed web_fetch results must be discarded"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("miner does not bridge across turns", async () => {
  const root = await makeSessionsRoot([
    {
      chat: "turns",
      lines: [
        tcEvent(1, "web_search"),
        tcEvent(1, "web_search"),
        // Turn ends here; the next event is a brand new turn.
        tcEvent(2, "web_fetch"),
        tcEvent(2, "web_fetch"),
        tcEvent(2, "web_fetch"),
      ],
    },
  ]);
  try {
    const patterns = await minePatternsFromSessions({
      roots: [root],
      contextWindow: 2,
      minSupport: 1,
    });
    const cross = patterns.find(
      (p) => p.contextKey === "web_search,web_search" && p.nextTool === "web_fetch"
    );
    assert.equal(cross, undefined, "must not bridge a pattern across turn boundaries");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
