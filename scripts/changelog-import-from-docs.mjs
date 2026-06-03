/**
 * One-time bootstrap: parse docs/reference/changelog.md → changelog/releases.json
 * Run: node scripts/changelog-import-from-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MD_PATH = path.join(ROOT, "docs", "reference", "changelog.md");
const OUT_PATH = path.join(ROOT, "changelog", "releases.json");

const md = fs.readFileSync(MD_PATH, "utf8");
const releases = [];

const sectionRe = /^## v(0\.0\.\d+) — (\d{4}-\d{2}-\d{2}) \{#v0-0-\d+\}/gm;
const parts = md.split(sectionRe);

// parts[0] = preamble, then triplets: version, date, body
for (let i = 1; i < parts.length; i += 3) {
  const version = parts[i];
  const date = parts[i + 1];
  let body = (parts[i + 2] ?? "").replace(/\r/g, "");
  body = body.replace(/^---\s*$/m, "").trim();

  let tagline = "";
  const shippedIdx = body.indexOf("**Shipped**");
  const intro = shippedIdx >= 0 ? body.slice(0, shippedIdx).trim() : body.split("\n\n")[0]?.trim() ?? "";
  tagline = intro
    .replace(/^\*\*Current alpha\*\*\.?\s*/i, "")
    .replace(/^\*\*[^*]+\*\*\.?\s*/, "")
    .replace(/\*\*/g, "")
    .trim();

  const shippedMatch = body.match(/\*\*Shipped\*\*\s*\n+([\s\S]*?)(?=\n---|\n## Planned|$)/);
  const shippedBlock = shippedMatch ? shippedMatch[1].trim() : "";
  const bullets = [];
  const docs = [];
  for (const line of shippedBlock.split("\n")) {
    const docLine = line.match(/^- \*\*Docs\*\* — (.+)$/);
    if (docLine) {
      const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m;
      while ((m = linkRe.exec(docLine[1]))) {
        docs.push({ label: m[1], href: m[2] });
      }
      continue;
    }
    if (line.startsWith("- ")) bullets.push(line.slice(2).replace(/\r/g, "").trim());
  }

  releases.push({
    version,
    date,
    tagline,
    summary: tagline,
    bullets,
    ...(docs.length ? { docs } : {}),
  });
}

releases.sort((a, b) => {
  const pa = a.version.split(".").map(Number);
  const pb = b.version.split(".").map(Number);
  for (let j = 0; j < 3; j++) {
    if (pb[j] !== pa[j]) return pb[j] - pa[j];
  }
  return 0;
});

const payload = {
  stage: "alpha",
  currentVersion: releases[0]?.version ?? "0.0.16",
  releases,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${OUT_PATH} (${releases.length} releases)`);
