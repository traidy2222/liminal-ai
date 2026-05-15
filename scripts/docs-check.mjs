/**
 * Lightweight internal link check for docs markdown files.
 * Run: npm run docs:check
 */
import fs from "node:fs";
import path from "node:path";

const docsRoot = path.resolve(import.meta.dirname, "..", "docs");

function listMdFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listMdFiles(p));
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = listMdFiles(docsRoot);
const linkRe = /\]\(([^)#]+\.md)(?:#[^)]*)?\)/g;
const errors = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    const target = m[1];
    if (target.startsWith("http")) continue;
    const resolved = path.normalize(path.join(dir, target));
    if (!fs.existsSync(resolved)) {
      errors.push(`${path.relative(docsRoot, file)} → ${target} (missing)`);
    }
  }
}

if (errors.length > 0) {
  console.error("docs:check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log(`docs:check OK (${files.length} markdown files)`);
