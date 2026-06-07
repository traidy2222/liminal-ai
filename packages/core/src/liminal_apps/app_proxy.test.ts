import { test } from "node:test";
import assert from "node:assert/strict";
import { isProxyUrlAllowed, normalizeProxyHosts } from "./app_proxy.js";

test("normalizeProxyHosts dedupes and caps", () => {
  const hosts = normalizeProxyHosts([
    "api.example.com",
    "https://API.example.com/path",
    "other.org",
  ]);
  assert.deepEqual(hosts, ["api.example.com", "other.org"]);
});

test("isProxyUrlAllowed matches allowlist", () => {
  const allow = ["api.open-meteo.com"];
  assert.equal(isProxyUrlAllowed("https://api.open-meteo.com/v1/forecast", allow), true);
  assert.equal(isProxyUrlAllowed("https://evil.com/", allow), false);
});
