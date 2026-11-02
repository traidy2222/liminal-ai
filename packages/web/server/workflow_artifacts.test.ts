import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkflowArtifact } from "./workflow_artifacts.js";
test("workflow downloads expose only saved deliverables inside this workspace", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "liminal-workflow-download-"),
  );
  const id = "12345678-1234-1234-1234-123456789abc",
    dir = path.join(root, ".agent_artifacts", "workflows", id);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "run.json"),
      JSON.stringify({ files: ["proposal.html"] }),
    );
    await writeFile(path.join(dir, "proposal.html"), "<!doctype html>Proposal");
    assert.match(
      (await readWorkflowArtifact(root, id, "proposal.html")).toString(),
      /Proposal/,
    );
    await assert.rejects(readWorkflowArtifact(root, id, "run.json"));
    await assert.rejects(
      readWorkflowArtifact(root, "../outside", "proposal.html"),
    );
    await writeFile(path.join(dir, "handoff.md"), "Not a saved deliverable");
    await assert.rejects(readWorkflowArtifact(root, id, "handoff.md"));
    const other = path.join(root, "other");
    await mkdir(other);
    await assert.rejects(readWorkflowArtifact(other, id, "proposal.html"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
