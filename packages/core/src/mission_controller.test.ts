import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  abandonInProgressTasks,
  loadLatestInProgressTask,
  resolveMissionAutonomyConfig,
  evaluateMissionContinue,
  shouldInjectResumeMission,
  userDeclinedMissionResume,
} from "./mission_controller.js";
import { parseRecalledNoteBlocks } from "./memory_rank.js";
import { detectContradictions } from "./memory_rank.js";

test("resolveMissionAutonomyConfig: mission off by default; no YOLO requirement when enabled", () => {
  const prevAuto = process.env.AGENT_MISSION_AUTONOMY;
  const prevYolo = process.env.AGENT_MISSION_REQUIRES_YOLO;
  delete process.env.AGENT_MISSION_AUTONOMY;
  delete process.env.AGENT_MISSION_REQUIRES_YOLO;
  try {
    const cfg = resolveMissionAutonomyConfig(null);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.requiresYolo, false);
  } finally {
    if (prevAuto === undefined) delete process.env.AGENT_MISSION_AUTONOMY;
    else process.env.AGENT_MISSION_AUTONOMY = prevAuto;
    if (prevYolo === undefined) delete process.env.AGENT_MISSION_REQUIRES_YOLO;
    else process.env.AGENT_MISSION_REQUIRES_YOLO = prevYolo;
  }
});

test("userDeclinedMissionResume detects abandonment phrasing", () => {
  assert.equal(userDeclinedMissionResume("we abandoned the KB research task"), true);
  assert.equal(userDeclinedMissionResume("we abondoned it"), true);
  assert.equal(userDeclinedMissionResume("don't continue that"), true);
  assert.equal(userDeclinedMissionResume("hEY!"), false);
});

test("shouldInjectResumeMission skips conversational turns", () => {
  assert.equal(shouldInjectResumeMission("hEY!", "conversational"), false);
  assert.equal(shouldInjectResumeMission("fix the auth bug", "coding"), true);
  assert.equal(
    shouldInjectResumeMission("please resume the KB research task", "conversational"),
    true
  );
  assert.equal(shouldInjectResumeMission("we abandoned that task", "coding"), false);
});

test("abandonInProgressTasks clears checkpoint on disk", async () => {
  const prevRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  const dir = mkdtempSync(join(tmpdir(), "liminal-mission-"));
  process.env.AGENT_GLOBAL_STORAGE_ROOT = dir;
  const notesPath = join(dir, "notes.json");
  writeFileSync(
    notesPath,
    JSON.stringify({
      "task:kb-research": JSON.stringify({
        id: "kb-research",
        goal: "KB research",
        progress_summary: "half done",
        next_steps: ["write guide"],
        status: "in_progress",
        updatedAt: "2026-06-10T00:00:00.000Z",
      }),
    }),
    "utf8"
  );
  try {
    assert.ok(await loadLatestInProgressTask());
    const cleared = await abandonInProgressTasks();
    assert.deepEqual(cleared, ["kb-research"]);
    assert.equal(await loadLatestInProgressTask(), null);
    const raw = JSON.parse(readFileSync(notesPath, "utf8")) as Record<string, string>;
    const body = JSON.parse(raw["task:kb-research"]!) as { status: string };
    assert.equal(body.status, "abandoned");
  } finally {
    if (prevRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
    else process.env.AGENT_GLOBAL_STORAGE_ROOT = prevRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evaluateMissionContinue: disabled when AGENT_MISSION_AUTONOMY=0", async () => {
  const prevAuto = process.env.AGENT_MISSION_AUTONOMY;
  delete process.env.AGENT_MISSION_AUTONOMY;
  try {
    const decision = await evaluateMissionContinue({
      taskId: "x",
      yolo: false,
      chainedSendsThisMission: 0,
      userAborted: false,
      terminationReason: "ok",
    });
    assert.equal(decision.continue, false);
    assert.equal(decision.reason, "disabled");
  } finally {
    if (prevAuto === undefined) delete process.env.AGENT_MISSION_AUTONOMY;
    else process.env.AGENT_MISSION_AUTONOMY = prevAuto;
  }
});

test("parseRecalledNoteBlocks extracts note keys from recall_relevant format", () => {
  const output = [
    "## Notes",
    "- [fact:port] score=0.920 — API listens on port 3001",
    "- [fact:name] score=0.880 — project is liminal",
  ].join("\n");
  const notes = parseRecalledNoteBlocks(output);
  assert.equal(notes.length, 2);
  assert.equal(notes[0]!.key, "fact:port");
  assert.match(notes[0]!.text, /3001/);
  assert.equal(notes[1]!.key, "fact:name");
});

test("detectContradictions uses parsed note keys for auto-resolve", () => {
  const recalled = parseRecalledNoteBlocks(
    "## Notes\n- [fact:port] score=0.99 — server port is 8080"
  );
  const contradictions = detectContradictions(recalled, [
    "health check passed on port 3001 for the API server",
  ]);
  assert.ok(contradictions.length >= 1);
  assert.equal(contradictions[0]!.noteKey, "fact:port");
});
