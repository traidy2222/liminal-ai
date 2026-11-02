#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [version, output] = process.argv.slice(2);
if (!version || !output)
  throw Error("Usage: write-desktop-release-notes.mjs <version> <output>");
const releases = JSON.parse(
  fs.readFileSync(path.join(root, "changelog/releases.json"), "utf8"),
);
const entry = releases.releases.find((r) => r.version === version);
if (!entry) throw Error(`Missing changelog entry for ${version}`);
const body = `## Liminal Desktop ${version} (beta)

${entry.summary}

${entry.bullets.map((b) => "- " + b).join("\n")}

### Install or update

Existing installations: **Settings → About & updates → Check for updates**. Install the app update to get both the new interface and bundled harness. Updates preserve your local configuration.

| Platform | Download | Run |
|---|---|---|
| Windows x64 | liminal-desktop-windows-x64-v${version}.zip | Extract the complete archive; run liminal_desktop.exe |
| macOS arm64 | liminal-desktop-macos-arm64-v${version}.zip | Extract the app; right-click → Open if required |
| Linux x64 | liminal-desktop-linux-x64-v${version}.tar.gz | Extract; run ./liminal_desktop |
| Harness only | liminald-runtime-v${version}.zip | Used by the in-app harness updater |

**Requirements:** Node.js 20+ on PATH. Keep the companion liminald folder and application files together. New installations can configure their provider in Settings or follow the setup guide.

[Workflow guide](https://github.com/traidy2222/liminal-ai/blob/v${version}-desktop/docs/guides/signature-workflows.md) · [Installation](https://github.com/traidy2222/liminal-ai/blob/v${version}-desktop/docs/start/install.md) · [License: FSL-1.1-MIT](https://github.com/traidy2222/liminal-ai/blob/v${version}-desktop/LICENSE)

Verify downloaded archives with their matching .sha256 files. This is a beta release.
`;
fs.writeFileSync(output, body, "utf8");
