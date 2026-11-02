import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('regression discovery never traverses ancestor links or node_modules',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'liminal-discovery-'));
 const pkg=path.join(root,'packages','fixture');mkdirSync(path.join(pkg,'node_modules','fixture'),{recursive:true});
 const marker=path.join(root,'calls.txt');
 writeFileSync(path.join(pkg,'only_regression.test.ts'),`import test from 'node:test';import {appendFileSync} from 'node:fs';test('fixture',()=>appendFileSync(${JSON.stringify(marker)},'x'));`);
 writeFileSync(path.join(pkg,'node_modules','fixture','bad_regression.test.ts'),`throw new Error('must not traverse dependencies')`);
 symlinkSync(pkg,path.join(pkg,'loop'),'junction');
 // Discovery-only output avoids running this repository's fixed companion suite.
 try{const result=spawnSync(process.execPath,[fileURLToPath(new URL('./test-review-regressions.mjs',import.meta.url)),'--list'],{cwd:root,encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);const files=JSON.parse(result.stdout);
 assert.deepEqual(files.filter(p=>p.includes('fixture/')),['packages/fixture/only_regression.test.ts']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
