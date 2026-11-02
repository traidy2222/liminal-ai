import 'dotenv/config';
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import {AgentHarness} from '../packages/core/dist/agent.js';
import {loadRuntimePreferences} from '../packages/core/dist/runtime_prefs.js';
import {resolveProviderConfig} from '../packages/core/dist/provider_config.js';
import {runHarnessEffectiveEnvContext} from '../packages/core/dist/harness_effective_env.js';
// Live benchmark: uses the configured provider and incurs normal inference usage.
// Minimal system prompt, no external tools: isolates harness preparation and streaming.
const p=await loadRuntimePreferences(process.cwd());
const cfg=await runHarnessEffectiveEnvContext(p,()=>resolveProviderConfig());
const h=new AgentHarness({openRouterApiKey:cfg.apiKey,baseURL:cfg.baseURL,model:cfg.model,runtimePreferences:p,workspaceRoot:process.cwd(),taskId:'latency-benchmark-'+Date.now(),context:{modelMaxTokens:131072,thresholdFraction:0.8,inceptionMessages:[{role:'system',content:'You are a helpful assistant. Answer the user concisely.'}]},maxToolRoundsPerTurn:2,maxRetries:0});
let started=0,first=null;const metrics=[];
h.emitter.on('text',e=>{if(e.channel!=='trace' && e.channel!=='reasoning' && e.delta?.trim() && first===null){first=Math.round(performance.now()-started);console.log('First visible answer text: '+first+'ms');}});
h.emitter.on('inference_latency',e=>metrics.push(e));
h.emitter.on('error',e=>console.log('Harness error: '+e.err.message));
const idleIndex=process.argv.indexOf('--idle-ms');
const idleMs=idleIndex>=0 ? Math.max(0,Math.min(10000,Number(process.argv[idleIndex+1])||0)) : 0;
if(idleMs) await new Promise(resolve=>setTimeout(resolve,idleMs));
started=performance.now();
await h.send('Explain how connection pooling works in PostgreSQL. Answer in one short sentence.');
const result={model:cfg.model,firstVisibleTextMs:first,totalMs:Math.round(performance.now()-started),metrics,scope:'Real harness, first turn, same selected model, minimal system prompt and no registered external tools; not a full desktop UI benchmark'};
await mkdir('.agent_artifacts',{recursive:true});
await writeFile('.agent_artifacts/response-latency-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(first===null?1:0);
