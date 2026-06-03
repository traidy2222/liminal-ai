#!/usr/bin/env node
/**
 * Renders all Liminal marketing compositions to ../../assets/marketing/videos/
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, "..");
const outDir = path.join(pkgRoot, "../../assets/marketing/videos");

const COMPOSITIONS = [
  { id: "Liminal-Hero", file: "liminal-hero.mp4" },
  { id: "Liminal-Harness", file: "liminal-harness.mp4" },
  { id: "Liminal-Features", file: "liminal-features.mp4" },
  { id: "Liminal-Transparency", file: "liminal-transparency.mp4" },
  { id: "Liminal-CTA", file: "liminal-cta.mp4" },
  { id: "Liminal-Promo-Full", file: "liminal-promo-full.mp4" },
  { id: "Liminal-Social-Teaser", file: "liminal-social-teaser.mp4" },
];

fs.mkdirSync(outDir, { recursive: true });

for (const { id, file } of COMPOSITIONS) {
  const out = path.join(outDir, file);
  console.log(`\n▶ Rendering ${id} → ${out}`);
  execSync(
    `npx remotion render ${JSON.stringify(id)} ${JSON.stringify(out)} --codec h264`,
    { cwd: pkgRoot, stdio: "inherit", env: process.env },
  );
}

console.log(`\n✓ Done. Outputs in ${outDir}`);
