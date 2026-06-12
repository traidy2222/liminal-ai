import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "remote-viewer");
const dest = join(root, "dist", "remote-viewer");
mkdirSync(dest, { recursive: true });
cpSync(join(src, "index.html"), join(dest, "index.html"));
