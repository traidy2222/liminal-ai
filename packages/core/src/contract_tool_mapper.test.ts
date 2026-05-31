import test from "node:test";
import assert from "node:assert/strict";
import {
  inferSpawnToolFamiliesFromChildConfig,
  mapContractToToolFamilies,
} from "./contract_tool_mapper.js";

test("mapContractToToolFamilies matches coding objective to code_intel and files_edit", () => {
  const m = mapContractToToolFamilies(
    "Refactor the auth module and run typecheck on changed files",
    "coding specialist"
  );
  assert.ok(m.families.includes("files_edit"));
  assert.ok(m.scores["files_edit"] !== undefined);
});

test("mapContractToToolFamilies matches web research to web family", () => {
  const m = mapContractToToolFamilies(
    "Fetch three URLs about climate policy and summarize agreements",
    "research analyst"
  );
  assert.ok(m.families.includes("web") || m.families.includes("files_edit"));
});

test("mapContractToToolFamilies defaults when query is empty", () => {
  const m = mapContractToToolFamilies("", "");
  assert.ok(m.families.includes("files_edit"));
  assert.equal(m.source, "default");
});

test("inferSpawnToolFamiliesFromChildConfig prefers userPrompt over goal label", () => {
  const m = inferSpawnToolFamiliesFromChildConfig({
    goal: "task-1",
    userPrompt: "Run npm test and fix type errors in the auth module",
    systemPrompt: "You are a TypeScript coding specialist.",
  });
  assert.ok(m.families.includes("files_edit"));
  assert.ok(m.families.includes("code_intel") || m.families.includes("shell"));
});

test("inferSpawnToolFamiliesFromChildConfig uses spawnContract when present", () => {
  const m = inferSpawnToolFamiliesFromChildConfig({
    goal: "label",
    userPrompt: "ignored when contract objective set",
    spawnContract: {
      objective: "Fetch three government URLs about EV subsidies",
      role: "research analyst",
    },
  });
  assert.ok(m.families.includes("web") || m.families.includes("files_edit"));
});
