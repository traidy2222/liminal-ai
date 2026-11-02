import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
const FILES = new Set([
  "proposal.html",
  "proposal.md",
  "reply-draft.eml",
  "research.json",
  "expense-review.json",
  "expense-review.md",
  "xero-handoff.json",
  "patch.diff",
  "test-evidence.txt",
  "handoff.md",
]);
/** Only generated deliverables, bounded to the active chat workspace; never arbitrary files/checkpoints. */
export async function readWorkflowArtifact(
  root: string,
  id: string,
  name: string,
) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !FILES.has(name))
    throw Error("Unknown workflow deliverable");
  const base = await realpath(root),
    folder = await realpath(
      path.join(root, ".agent_artifacts", "workflows", id),
    );
  if (!folder.startsWith(base + path.sep))
    throw Error("Workflow outside workspace");
  const file = await realpath(path.join(folder, name));
  if (path.dirname(file) !== folder)
    throw Error("Deliverable outside workflow");
  const saved = JSON.parse(
    await readFile(path.join(folder, "run.json"), "utf8"),
  );
  if (!Array.isArray(saved.files) || !saved.files.includes(name))
    throw Error("Deliverable is not in the saved run");
  const info = await stat(file);
  if (!info.isFile() || info.size > 2 * 1024 * 1024)
    throw Error("Deliverable is not an exportable file");
  return readFile(file);
}
