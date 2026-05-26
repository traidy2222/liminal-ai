import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankDocumentsForQuery,
  chatScopeMultiplier,
  type RankableDoc,
} from "./memory_rank.js";

describe("federation: chatScopeMultiplier", () => {
  it("returns 1 when no current chat is known (cli / eval mode)", () => {
    const m = chatScopeMultiplier({
      noteScope: "workspace",
      noteChatId: "chat_x",
      noteWorkspaceFp: "git:foo/bar",
      currentChatId: undefined,
      currentWorkspaceFp: "git:foo/bar",
      siblingDiscount: 0.85,
    });
    assert.equal(m, 1);
  });

  it("returns 1 for the writer's own chat", () => {
    const m = chatScopeMultiplier({
      noteScope: "workspace",
      noteChatId: "chat_a",
      noteWorkspaceFp: "git:foo/bar",
      currentChatId: "chat_a",
      currentWorkspaceFp: "git:foo/bar",
      siblingDiscount: 0.85,
    });
    assert.equal(m, 1);
  });

  it("applies the sibling discount when a different chat wrote it in the same workspace", () => {
    const m = chatScopeMultiplier({
      noteScope: "workspace",
      noteChatId: "chat_a",
      noteWorkspaceFp: "git:foo/bar",
      currentChatId: "chat_b",
      currentWorkspaceFp: "git:foo/bar",
      siblingDiscount: 0.85,
    });
    assert.equal(m, 0.85);
  });

  it("does NOT discount cross-workspace global notes", () => {
    const m = chatScopeMultiplier({
      noteScope: "global",
      noteChatId: "chat_a",
      noteWorkspaceFp: "git:foo/bar",
      currentChatId: "chat_b",
      currentWorkspaceFp: "git:other/repo",
      siblingDiscount: 0.85,
    });
    assert.equal(m, 1);
  });

  it("does NOT discount a sibling chat's global-scope note in the same workspace", () => {
    const m = chatScopeMultiplier({
      noteScope: "global",
      noteChatId: "chat_a",
      noteWorkspaceFp: "git:foo/bar",
      currentChatId: "chat_b",
      currentWorkspaceFp: "git:foo/bar",
      siblingDiscount: 0.85,
    });
    assert.equal(m, 1);
  });

  it("clamps the discount to a safe range", () => {
    const tooLow = chatScopeMultiplier({
      noteScope: "workspace",
      noteChatId: "a",
      noteWorkspaceFp: "x",
      currentChatId: "b",
      currentWorkspaceFp: "x",
      siblingDiscount: -1,
    });
    assert.equal(tooLow, 0.1);
    const tooHigh = chatScopeMultiplier({
      noteScope: "workspace",
      noteChatId: "a",
      noteWorkspaceFp: "x",
      currentChatId: "b",
      currentWorkspaceFp: "x",
      siblingDiscount: 999,
    });
    assert.equal(tooHigh, 1);
  });
});

describe("federation: rankDocumentsForQuery hard scope filter", () => {
  function doc(overrides: Partial<RankableDoc>): RankableDoc {
    return {
      id: overrides.id ?? "k",
      text: overrides.text ?? "the answer is forty two",
      ...overrides,
    };
  }

  it("drops chat-scope notes when the caller is a different chat", () => {
    const docs = [
      doc({ id: "k1", scope: "chat", chatId: "chat_a", text: "forty two from chat a" }),
      doc({ id: "k2", scope: "workspace", chatId: "chat_a", text: "forty two from chat a workspace" }),
    ];
    const ranked = rankDocumentsForQuery("forty two", docs, { currentChatId: "chat_b" });
    const ids = ranked.map((r) => r.id);
    assert.ok(!ids.includes("k1"), "chat-scope note must be hidden from other chats");
    assert.ok(ids.includes("k2"), "workspace-scope note must remain visible");
  });

  it("keeps chat-scope notes for their own chat", () => {
    const docs = [
      doc({ id: "k1", scope: "chat", chatId: "chat_a", text: "private forty two" }),
    ];
    const ranked = rankDocumentsForQuery("forty two", docs, { currentChatId: "chat_a" });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.id, "k1");
  });

  it("hides chat-scope notes entirely when no chat is active", () => {
    const docs = [
      doc({ id: "k1", scope: "chat", chatId: "chat_a", text: "forty two" }),
      doc({ id: "k2", scope: "global", text: "forty two global" }),
    ];
    const ranked = rankDocumentsForQuery("forty two", docs, {});
    const ids = ranked.map((r) => r.id);
    assert.ok(!ids.includes("k1"));
    assert.ok(ids.includes("k2"));
  });

  it("globalOnly filter keeps only global-scope notes", () => {
    const docs = [
      doc({ id: "k1", scope: "global", text: "forty two global" }),
      doc({ id: "k2", scope: "workspace", chatId: "chat_a", text: "forty two project" }),
      doc({ id: "k3", scope: "chat", chatId: "chat_a", text: "forty two private" }),
    ];
    const ranked = rankDocumentsForQuery("forty two", docs, { currentChatId: "chat_a", globalOnly: true });
    const ids = ranked.map((r) => r.id);
    assert.deepEqual(ids, ["k1"]);
  });

  it("own-chat notes rank ABOVE sibling-chat notes when content is equal", () => {
    const docs = [
      doc({
        id: "own",
        scope: "workspace",
        chatId: "chat_self",
        workspaceFingerprint: "git:proj",
        text: "tabs over spaces",
      }),
      doc({
        id: "sibling",
        scope: "workspace",
        chatId: "chat_other",
        workspaceFingerprint: "git:proj",
        text: "tabs over spaces",
      }),
    ];
    const ranked = rankDocumentsForQuery("tabs over spaces", docs, {
      currentChatId: "chat_self",
      currentWorkspaceFingerprint: "git:proj",
      siblingDiscount: 0.7,
    });
    assert.equal(ranked[0]!.id, "own");
    assert.equal(ranked[1]!.id, "sibling");
    assert.ok(ranked[0]!.score > ranked[1]!.score, "own-chat note must outrank sibling");
  });
});
