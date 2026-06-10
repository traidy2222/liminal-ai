import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = path.join(__dirname, "..", "dist", "terminal-vendor");

const ghosttyDist = path.dirname(require.resolve("ghostty-web"));
const ghosttyRoot = path.dirname(ghosttyDist);

const files = [
  [path.join(ghosttyDist, "ghostty-web.umd.cjs"), "ghostty-web.umd.cjs"],
  [path.join(ghosttyDist, "ghostty-web.js"), "ghostty-web.js"],
  [path.join(ghosttyDist, "__vite-browser-external-2447137e.js"), "__vite-browser-external-2447137e.js"],
  [path.join(ghosttyRoot, "ghostty-vt.wasm"), "ghostty-vt.wasm"],
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const [src, destName] of files) {
  if (!existsSync(src)) {
    console.error(`ghostty-web asset missing: ${src}`);
    process.exit(1);
  }
  cpSync(src, path.join(outDir, destName));
}

console.log(`staged ${files.length} terminal vendor files -> ${outDir}`);
