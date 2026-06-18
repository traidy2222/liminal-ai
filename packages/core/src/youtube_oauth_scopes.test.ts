import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  missingYoutubeScopes,
  scopesForYoutubeConnect,
  YT_ANALYTICS_MONETARY_READONLY_SCOPE,
  YT_ANALYTICS_READONLY_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_MANAGE_SCOPE,
} from "./youtube_oauth_scopes.js";

describe("youtube_oauth_scopes", () => {
  it("read_only includes data + analytics readonly", () => {
    const scopes = scopesForYoutubeConnect({ mode: "read_only" });
    assert.ok(scopes.includes(YOUTUBE_READONLY_SCOPE));
    assert.ok(scopes.includes(YT_ANALYTICS_READONLY_SCOPE));
    assert.equal(scopes.includes(YOUTUBE_UPLOAD_SCOPE), false);
  });

  it("read_write adds full manage scope (videos.update needs youtube, not upload alone)", () => {
    const scopes = scopesForYoutubeConnect({ mode: "read_write" });
    assert.ok(scopes.includes(YOUTUBE_MANAGE_SCOPE));
  });

  it("upload-only token is missing manage for read_write reconnect", () => {
    const missing = missingYoutubeScopes(
      ["https://www.googleapis.com/auth/youtube.upload", YT_ANALYTICS_READONLY_SCOPE],
      { mode: "read_write" }
    );
    assert.ok(missing.includes(YOUTUBE_MANAGE_SCOPE));
  });

  it("monetary adds revenue analytics scope", () => {
    const scopes = scopesForYoutubeConnect({ mode: "read_only", monetary: true });
    assert.ok(scopes.includes(YT_ANALYTICS_MONETARY_READONLY_SCOPE));
  });

  it("monetary scope satisfies analytics readonly requirement", () => {
    const missing = missingYoutubeScopes([YT_ANALYTICS_MONETARY_READONLY_SCOPE, YOUTUBE_READONLY_SCOPE], {
      mode: "read_only",
      monetary: true,
    });
    assert.deepEqual(missing, []);
  });
});
