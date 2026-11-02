import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = [];
function discover(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) discover(file);
    else if (entry.isFile() && /_regression\.test\.ts$/.test(entry.name)) files.push(file);
  }
}
discover('packages');
files.push('scripts/regression_discovery.test.mjs');
files.push('packages/web/server/local_auth.test.ts', 'packages/web/server/local_auth_http.test.ts', 'packages/core/src/harness_effective_env.test.ts', 'packages/core/src/streaming_completion.test.ts', 'packages/core/src/provider_token_scrub.test.ts');
if (process.argv.includes('--list')) { console.log(JSON.stringify(files.sort())); process.exit(0); }
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...files.sort()], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
