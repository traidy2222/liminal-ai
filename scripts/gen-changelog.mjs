/**
 * Generate CHANGELOG.md and docs/reference/changelog.md from changelog/releases.json.
 *
 * Edit releases.json (newest first), then: npm run changelog:gen
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_PATH = path.join(ROOT, "changelog", "releases.json");

function slugFor(version) {
  return `v${version.replace(/\./g, "-")}`;
}

function anchorFor(version) {
  return slugFor(version);
}

function loadReleases() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Missing ${DATA_PATH} — add a release or run npm run changelog:import`);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!Array.isArray(data.releases) || data.releases.length === 0) {
    throw new Error("releases.json must have a non-empty releases array");
  }
  return data;
}

function formatBullets(bullets) {
  return bullets.map((b) => (b.startsWith("- ") ? b : `- ${b}`)).join("\n");
}

function formatDocs(links) {
  if (!links?.length) return "";
  return `\n- **Docs** — ${links
    .map((l) => `[${l.label}](${l.href})`)
    .join(", ")}`;
}

function sectionForRelease(r, { currentVersion }) {
  const slug = slugFor(r.version);
  const anchor = anchorFor(r.version);
  const isCurrent = r.version === currentVersion;
  const head = `## v${r.version} — ${r.date} {#${anchor}}\n\n`;
  const tag = isCurrent
    ? `**${dataStageLabel(r, currentVersion)}.** ${r.tagline}\n\n`
    : `${r.tagline ? `${r.tagline}\n\n` : ""}`;
  const shipped =
    r.bullets?.length > 0
      ? `**Shipped**\n\n${formatBullets(r.bullets)}${formatDocs(r.docs)}\n\n`
      : "";
  return head + tag + shipped;
}

function dataStageLabel(r, currentVersion) {
  if (r.version === currentVersion) return "**Current alpha**";
  return "";
}

function buildDocsChangelog(data) {
  const current = data.currentVersion ?? data.releases[0]?.version;
  const lines = [
    "# Changelog",
    "",
    "All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) on the `main` branch.",
    "",
    `**Current stage:** **${data.stage ?? "alpha"}** (\`v${current}\` tip of \`main\`, ${data.releases[0]?.date ?? ""}). The workspace package may read \`0.1.0\`, but **beta**, **RC**, and a **v0.1.0 public preview** have not been declared as product releases yet.`,
    "",
    "Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.",
    "",
    "| Surface | Where |",
    "| -------- | ----- |",
    "| **Source of truth** | [\`changelog/releases.json\`](../../changelog/releases.json) — run \`npm run changelog:gen\` |",
    "| **Technical changelog (this page)** | Generated from JSON — full `Shipped` bullets |",
    "| **Marketing changelog** | [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog) |",
    "| **Short index** | [CHANGELOG.md](https://github.com/traidy2222/liminal-ai/blob/main/CHANGELOG.md) |",
    "",
    "After editing JSON: `npm run changelog:gen`, commit, push, then in [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website): `npm run docs-portal:sync` and `npm run docs-portal:deploy`.",
    "",
    "---",
    "",
  ];

  for (const r of data.releases) {
    const isCurrent = r.version === current;
    const head = `## v${r.version} — ${r.date} {#${anchorFor(r.version)}}\n\n`;
    let intro = "";
    if (isCurrent) {
      intro = `**Current alpha.** ${r.tagline}\n\n`;
    } else if (r.tagline) {
      intro = `${r.tagline}\n\n`;
    }
    const shipped =
      r.bullets?.length > 0
        ? `**Shipped**\n\n${formatBullets(r.bullets)}${formatDocs(r.docs)}\n\n`
        : "";
    lines.push(head + intro + shipped + "---\n");
  }

  lines.push(
    "## Planned (not started)",
    "",
    "See the full [Roadmap](./roadmap.md) for what each milestone means.",
    "",
    "| Stage | Target | Status |",
    "|-------|--------|--------|",
    "| Beta | Stability + defaults freeze candidate | Not started |",
    "| RC | Ship checklist, docs freeze | Not started |",
    "| v0.1.0 | Public preview tag + install GA | Not started |",
    "",
    "---",
    "",
    "**Commits on `main`:** [github.com/traidy2222/liminal-ai/commits/main](https://github.com/traidy2222/liminal-ai/commits/main)",
    ""
  );
  return lines.join("\n");
}

function buildRootChangelog(data) {
  const current = data.currentVersion ?? data.releases[0]?.version;
  const lines = [
    "# Changelog",
    "",
    "All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) are documented here and on the docs portal: [docs.vireondynamics.com/liminal/reference/changelog](https://docs.vireondynamics.com/liminal/reference/changelog).",
    "",
    `**Current stage:** **${data.stage ?? "alpha"}** (\`v${current}\` tip of \`main\`, ${data.releases[0]?.date ?? ""}). **Beta**, **RC**, and **v0.1.0 public preview** have not been declared as product releases yet.`,
    "",
    "**Single source:** edit [`changelog/releases.json`](changelog/releases.json), then run `npm run changelog:gen`.",
    "",
    "Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.",
    "",
    "Marketing (richer notes): [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog)",
    "",
  ];

  for (const r of data.releases) {
    const anchor = anchorFor(r.version);
    const label =
      r.version === current ? ` — Current alpha` : "";
    lines.push(`## [v${r.version}] — ${r.date}${label}\n`);
    lines.push(`${r.summary ?? r.tagline}\n`);
    lines.push(
      `[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#${anchor})\n`
    );
  }

  lines.push(
    "---",
    "",
    "Older entries: [docs changelog](https://docs.vireondynamics.com/liminal/reference/changelog).",
    ""
  );
  return lines.join("\n");
}

const data = loadReleases();
const docsMd = buildDocsChangelog(data);
const rootMd = buildRootChangelog(data);

fs.writeFileSync(path.join(ROOT, "docs", "reference", "changelog.md"), docsMd);
fs.writeFileSync(path.join(ROOT, "CHANGELOG.md"), rootMd);
console.log(
  `Wrote docs/reference/changelog.md and CHANGELOG.md (${data.releases.length} releases, current v${data.currentVersion ?? data.releases[0]?.version})`
);
