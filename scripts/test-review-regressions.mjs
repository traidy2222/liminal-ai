import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync('packages', { recursive: true }).filter(p => typeof p === 'string' && /_regression\.test\.ts$/.test(p) && !p.includes('node_modules')).map(p => `packages/${p.replaceAll('\\', '/')}`);
files.push('packages/web/server/local_auth.test.ts', 'packages/web/server/local_auth_http.test.ts', 'packages/core/src/harness_effective_env.test.ts', 'packages/core/src/streaming_completion.test.ts', 'packages/core/src/provider_token_scrub.test.ts');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...files.sort()], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
