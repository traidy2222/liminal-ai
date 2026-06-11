import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArmUrl,
  ensureArmApiVersion,
  normalizeArmPath,
  pickArmApiVersion,
} from "./azure_arm_api.js";

test("normalizeArmPath adds leading slash", () => {
  assert.equal(normalizeArmPath("subscriptions"), "/subscriptions");
  assert.equal(normalizeArmPath("/subscriptions"), "/subscriptions");
});

test("buildArmUrl fixes missing slash and api-version", () => {
  const url = buildArmUrl("subscriptions");
  assert.equal(url, "https://management.azure.com/subscriptions?api-version=2022-12-01");
});

test("ensureArmApiVersion keeps existing query", () => {
  assert.equal(
    ensureArmApiVersion("/subscriptions?api-version=2020-01-01"),
    "/subscriptions?api-version=2020-01-01"
  );
});

test("pickArmApiVersion prefers stable latest", () => {
  assert.equal(
    pickArmApiVersion(["2021-07-01", "2022-11-01-preview", "2023-03-01"]),
    "2023-03-01"
  );
});
