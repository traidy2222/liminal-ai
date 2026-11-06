// Run from the staged runtime to resolve its own native binary and Node ABI.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(
  path.resolve(process.argv[2] ?? process.cwd(), "package.json"),
);
const Database = require("better-sqlite3");
const db = new Database(":memory:");
try {
  db.exec(
    "CREATE TABLE native_probe(value TEXT);INSERT INTO native_probe VALUES('ok')",
  );
  if (db.prepare("SELECT value FROM native_probe").get().value !== "ok")
    throw new Error("SQLite native smoke failed");
  console.log(
    "better-sqlite3 native ABI smoke passed on " +
      process.version +
      " " +
      process.platform +
      "/" +
      process.arch,
  );
} finally {
  db.close();
}
