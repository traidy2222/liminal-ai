import path from "node:path";
import { statSync } from "node:fs";

function isPowerShellCoreModuleRoot(entry: string): boolean {
  const root = entry.trim();
  // Preserve custom/relative/network locations. Avoid probing a UNC server on
  // the synchronous shell-launch path just to classify its module directory.
  if (!path.isAbsolute(root) || /^(?:\\\\|\/\/)/.test(root) || path.basename(root).toLowerCase() !== "modules") return false;
  try {
    return statSync(path.join(root, "..", "pwsh.exe")).isFile();
  } catch {
    return false;
  }
}

/**
 * Match module inheritance to the selected child shell without changing the
 * parent. WindowsPS launched through Node otherwise inherits incompatible Core
 * system modules which can shadow built-ins such as Get-FileHash.
 * https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_psmodulepath
 */
export function prepareShellChildEnvironment(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const child = { ...environment };
  if (platform !== "win32" || !/^powershell(?:\.exe)?$/i.test(path.win32.basename(executable))) return child;
  for (const [name, value] of Object.entries(child)) {
    if (name.toLowerCase() !== "psmodulepath" || value === undefined) continue;
    const entries = value.split(";");
    const retained = entries.filter((entry) => !isPowerShellCoreModuleRoot(entry));
    if (retained.length === entries.length) continue;
    if (retained.some((entry) => entry.trim())) child[name] = retained.join(";");
    else delete child[name]; // Let WindowsPS construct native defaults.
  }
  return child;
}
