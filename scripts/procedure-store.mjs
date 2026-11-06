#!/usr/bin/env node
/** Explicit paths only. Recovery creates a new profile; never overwrites a store. */
import fs from "node:fs/promises";
import path from "node:path";
import { ProcedureStore } from "../packages/core/dist/procedural_memory/store.js";
import { fingerprint } from "../packages/core/dist/procedural_memory/model.js";
const [action, ...args] = process.argv.slice(2),
  get = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined);
function absolute(value, label) {
  if (!value || !path.isAbsolute(value))
    throw new Error(label + " must be an explicit absolute path");
  return path.resolve(value);
}
if (action === "restore") {
  const source = absolute(get("--from"), "--from"),
    destination = absolute(get("--to"), "--to");
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, "backup-manifest.json"), "utf8"),
  );
  for (const file of manifest.files) {
    if (
      file.path !== "procedures.sqlite" &&
      !/^evidence\/[a-f0-9]{64}\.json$/.test(file.path)
    )
      throw new Error("Invalid backup path");
    const bytes = await fs.readFile(path.join(source, file.path));
    if (fingerprint(bytes) !== file.sha256)
      throw new Error("Backup fingerprint mismatch: " + file.path);
  }
  await fs.mkdir(destination);
  await fs.mkdir(path.join(destination, "evidence"));
  for (const file of manifest.files)
    await fs.copyFile(
      path.join(source, file.path),
      path.join(destination, file.path),
    );
  const restored = new ProcedureStore(
    path.join(destination, "procedures.sqlite"),
  );
  restored.close();
  console.log(
    JSON.stringify({ restoredTo: destination, installedAppChanged: false }),
  );
} else if (action === "check" || action === "backup") {
  const filename = absolute(get("--db"), "--db");
  await fs.access(filename);
  const store = new ProcedureStore(filename);
  try {
    if (action === "check") {
      console.log(
        JSON.stringify({
          schema: store.db.pragma("user_version", { simple: true }),
          integrity: store.db.pragma("quick_check", { simple: true }),
        }),
      );
    } else {
      const destination = absolute(get("--to"), "--to");
      await fs.mkdir(destination);
      const backupPath = path.join(destination, "procedures.sqlite");
      await store.backup(backupPath);
      const snapshot = new ProcedureStore(backupPath);
      let hashes;
      try {
        hashes = [
          ...new Set(
            snapshot.db
              .prepare("SELECT body FROM events")
              .all()
              .map((row) => JSON.parse(row.body).data?.artifactHash)
              .filter(
                (hash) =>
                  typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
              ),
          ),
        ];
      } finally {
        snapshot.close();
      }
      await fs.mkdir(path.join(destination, "evidence"));
      const files = [];
      for (const hash of hashes) {
        const relative = "evidence/" + hash + ".json",
          bytes = await fs.readFile(
            path.join(path.dirname(filename), relative),
          );
        if (fingerprint(bytes) !== hash)
          throw new Error("Evidence fingerprint mismatch: " + hash);
        await fs.writeFile(path.join(destination, relative), bytes, {
          flag: "wx",
        });
        files.push({ path: relative, sha256: hash });
      }
      files.push({
        path: "procedures.sqlite",
        sha256: fingerprint(await fs.readFile(backupPath)),
      });
      await fs.writeFile(
        path.join(destination, "backup-manifest.json"),
        JSON.stringify(
          { schemaVersion: 1, createdAt: new Date().toISOString(), files },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          backupDirectory: destination,
          evidenceArtifacts: hashes.length,
        }),
      );
    }
  } finally {
    store.close();
  }
} else
  throw new Error(
    "Usage: procedure-store.mjs check --db ABSOLUTE.sqlite | backup --db ABSOLUTE.sqlite --to NEW_ABSOLUTE_DIRECTORY | restore --from BACKUP_DIRECTORY --to NEW_PROFILE_DIRECTORY",
  );
