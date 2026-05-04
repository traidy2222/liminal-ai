/**
 * Shallow repo tree for world context + repo_map tool (domain-agnostic orientation).
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES_PER_DIR = 40;
const MAX_DEPTH_PACKAGES = 2;

/** Options for {@link gatherRepoMapLines}. */
export interface RepoMapOptions {
  /** "packages" = depth-2 under ./packages if it exists; "root" = depth-1 under cwd */
  scope?: "packages" | "root";
  maxDepth?: number;
}

async function listOneLevel(dir: string, prefix: string): Promise<string[]> {
  const lines: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return lines;
  }
  names.sort((a, b) => a.localeCompare(b));
  let n = 0;
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (n++ >= MAX_ENTRIES_PER_DIR) {
      lines.push(`${prefix}… (${names.length - MAX_ENTRIES_PER_DIR} more omitted)`);
      break;
    }
    const full = path.join(dir, name);
    let isDir = false;
    try {
      const st = await stat(full);
      isDir = st.isDirectory();
    } catch {
      continue;
    }
    lines.push(`${prefix}${isDir ? name + "/" : name}`);
  }
  return lines;
}

/** Build compact text lines for [WORLD CONTEXT] or repo_map tool. */
export async function gatherRepoMapLines(opts?: RepoMapOptions): Promise<string[]> {
  const cwd = process.cwd();
  const scope = opts?.scope ?? "packages";
  const lines: string[] = [];

  const pkgRoot = path.join(cwd, "packages");
  if (scope === "packages") {
    try {
      const st = await stat(pkgRoot);
      if (!st.isDirectory()) throw new Error("no packages");
    } catch {
      lines.push("(no ./packages — monorepo layout not detected)");
      lines.push(...(await listOneLevel(cwd, "")));
      return lines;
    }
    lines.push("packages/");
    const pkgs = await readdir(pkgRoot);
    pkgs.sort((a, b) => a.localeCompare(b));
    for (const p of pkgs.slice(0, 24)) {
      if (p.startsWith(".")) continue;
      const sub = path.join(pkgRoot, p);
      try {
        const st = await stat(sub);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      lines.push(`  ${p}/`);
      const inner = path.join(sub, "src");
      const innerDir = (await stat(inner).catch(() => null))?.isDirectory() ? inner : sub;
      const sublines = await listOneLevel(innerDir, "    ");
      for (const s of sublines.slice(0, MAX_DEPTH_PACKAGES === 2 ? 20 : 12)) lines.push(s);
    }
    return lines;
  }

  // root scope
  for (const s of await listOneLevel(cwd, "")) lines.push(s);
  return lines;
}
