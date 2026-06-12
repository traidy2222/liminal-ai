import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCloudJoinUrl,
  buildLanJoinUrl,
  createRemoteSessionGrant,
  grantIsExpired,
  mintJoinCode,
  parseRemoteSlashCommand,
  remoteCommandAllowed,
  remoteSessionTtlMs,
} from "./remote_session.js";

describe("remote_session", () => {
  it("mintJoinCode uses safe alphabet", () => {
    const code = mintJoinCode(8);
    assert.equal(code.length, 8);
    assert.match(code, /^[A-Z2-9]+$/);
  });

  it("remoteCommandAllowed gates by role", () => {
    assert.equal(remoteCommandAllowed("owner", "send_message"), true);
    assert.equal(remoteCommandAllowed("view", "send_message"), false);
    assert.equal(remoteCommandAllowed("view", "replay_transcript"), true);
    assert.equal(remoteCommandAllowed("control", "send_message"), true);
    assert.equal(remoteCommandAllowed("control", "pty_open"), false);
  });

  it("buildLanJoinUrl and buildCloudJoinUrl", () => {
    assert.equal(
      buildLanJoinUrl({ host: "192.168.1.10", port: 8787, joinCode: "ABC123" }),
      "http://192.168.1.10:8787/remote/join?code=ABC123"
    );
    assert.equal(
      buildCloudJoinUrl({ joinCode: "ABC123", origin: "https://example.com" }),
      "https://example.com/remote/join/ABC123"
    );
  });

  it("createRemoteSessionGrant sets expiry from TTL", () => {
    const now = 1_700_000_000_000;
    const grant = createRemoteSessionGrant({
      chatId: "chat_abc",
      mode: "view",
      now,
    });
    assert.equal(grant.chatId, "chat_abc");
    assert.equal(grant.role, "view");
    assert.ok(grant.joinCode.length >= 4);
    assert.ok(grant.joinToken.length >= 32);
    assert.equal(grant.expiresAt, now + remoteSessionTtlMs());
    assert.equal(grantIsExpired(grant, grant.expiresAt), true);
  });

  it("parseRemoteSlashCommand", () => {
    assert.deepEqual(parseRemoteSlashCommand("/remote"), {
      action: "enable",
      mode: "view",
      cloud: false,
    });
    assert.deepEqual(parseRemoteSlashCommand("/remote control"), {
      action: "enable",
      mode: "control",
      cloud: false,
    });
    assert.deepEqual(parseRemoteSlashCommand("/remote cloud control"), {
      action: "enable",
      mode: "control",
      cloud: true,
    });
    assert.deepEqual(parseRemoteSlashCommand("/remote off"), { action: "disable" });
    assert.deepEqual(parseRemoteSlashCommand("/remote status"), { action: "status" });
    assert.deepEqual(parseRemoteSlashCommand("/remote revoke ABC"), {
      action: "revoke",
      joinCode: "ABC",
    });
    assert.equal(parseRemoteSlashCommand("/help"), null);
  });
});
