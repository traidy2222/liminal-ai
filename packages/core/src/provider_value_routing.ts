/** Endpoint value selection: current prices + measured speed, with warm-route hysteresis. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { globalPath } from "./global_storage.js";

export interface ProviderEndpoint {
  provider_name: string;
  tag: string;
  pricing: { prompt?: string; completion?: string; input_cache_read?: string };
  latency_last_30m?: number | {p50?:number;p90?:number} | null;
  throughput_last_30m?: number | {p50?:number;p90?:number} | null;
  status?: number;
  service_tier?: string | null;
  supported_parameters?: string[];
  context_length?:number;
  max_prompt_tokens?:number|null;
}
export interface ProviderObservation {
  model: string; provider: string | null; scope?: string;
  ts: string; ttftMs?: number; latencyMs?: number;
  inputTokens?: number | null; cachedTokens?: number | null; outputTokens?: number | null;
  providerEndpoint?: string;
}
export interface RankedEndpoint {
  tag: string; provider: string; tps: number; ttftMs: number;
  expectedCostUsd: number; score: number; samples: number;
}
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const median = (a: number[]) => { const s = [...a].sort((a,b)=>a-b); return s.length ? s[Math.floor(s.length/2)]! : 0; };
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function rankProviderEndpoints(endpoints: ProviderEndpoint[], rows: ProviderObservation[], opts: {
  model: string; inputTokens: number; outputTokens?: number; minTps: number; maxLatencySeconds: number;
  requireTools?: boolean; only?: string[]; ignore?: string[]; maxPrice?: {prompt?:number;completion?:number};
}): RankedEndpoint[] {
  const standard = endpoints.filter(e => e.tag && e.provider_name && (e.status===undefined||e.status===0) && !["flex", "priority", "batch"].includes(e.service_tier ?? ""));
  const matches = (e: ProviderEndpoint, value: string) => normalize(e.provider_name) === normalize(value) || e.tag === value || e.tag.startsWith(value + "/");
  const ranked: RankedEndpoint[] = [];
  for (const e of standard) {
    if (opts.only?.length && !opts.only.some(v=>matches(e,v))) continue;
    if (opts.ignore?.some(v=>matches(e,v))) continue;
    if (opts.requireTools && !e.supported_parameters?.includes("tools")) continue;
    if(e.max_prompt_tokens&&opts.inputTokens>e.max_prompt_tokens||e.context_length&&opts.inputTokens+(opts.outputTokens??512)>e.context_length)continue;
    const prompt = Number(e.pricing.prompt), completion = Number(e.pricing.completion);
    if (![prompt,completion].every(n=>Number.isFinite(n)&&n>=0)) continue;
    if (opts.maxPrice?.prompt && prompt*1e6>opts.maxPrice.prompt || opts.maxPrice?.completion && completion*1e6>opts.maxPrice.completion) continue;
    // Old display-name observations are safe only when that provider has one
    // standard endpoint. Never apply a flex/priority measurement to another variant.
    const unique = standard.filter(x=>normalize(x.provider_name)===normalize(e.provider_name)).length===1;
    const recent = rows.filter(r=>Date.now()-Date.parse(r.ts)<86_400_000&&r.model===opts.model && r.scope==="agent" &&
      (r.providerEndpoint ? r.providerEndpoint===e.tag : unique&&normalize(r.provider??"")===normalize(e.provider_name))).slice(-12);
    const speeds = recent.filter(r=>positive(r.outputTokens)&&r.outputTokens>=32&&positive(r.ttftMs)&&positive(r.latencyMs)&&r.latencyMs>r.ttftMs)
      .map(r=>r.outputTokens!*1000/(r.latencyMs!-r.ttftMs!));
    const waits = recent.flatMap(r=>positive(r.ttftMs)?[r.ttftMs]:[]);
    const reportedTps=typeof e.throughput_last_30m==="object"?e.throughput_last_30m?.p50:e.throughput_last_30m;
    const reportedLatency=typeof e.latency_last_30m==="object"?e.latency_last_30m?.p50:e.latency_last_30m;
    const tps = speeds.length>=2 ? median(speeds) : reportedTps;
    // Endpoint API percentile latencies are milliseconds. Routing preferences
    // are seconds; convert the preference below, not these reported values.
    const ttftMs = waits.length>=2 ? median(waits) : positive(reportedLatency) ? reportedLatency : undefined;
    if (!positive(tps) || !positive(ttftMs)) continue; // Unknown is not "fast" or "zero latency".
    const totals = recent.reduce((a,r)=>({input:a.input+(r.inputTokens??0),cached:a.cached+(r.cachedTokens??0)}),{input:0,cached:0});
    const cacheRate = totals.input ? Math.min(.95,totals.cached/totals.input) : 0;
    const cacheRead = e.pricing.input_cache_read===undefined ? prompt : Number(e.pricing.input_cache_read);
    const inputCost = prompt*(1-cacheRate)+(Number.isFinite(cacheRead)&&cacheRead>=0?cacheRead:prompt)*cacheRate;
    const output = opts.outputTokens ?? 512;
    const expectedCostUsd = opts.inputTokens*inputCost+output*completion;
    // Dollar-seconds: use total input/output cost and completion time, rather
    // than output price or TPS alone. Existing cached inputs reduce the estimate.
    const score = expectedCostUsd*(ttftMs/1000+output/tps);
    ranked.push({tag:e.tag,provider:e.provider_name,tps,ttftMs,expectedCostUsd,score,samples:recent.length});
  }
  const preferred = ranked.filter(e=>(opts.minTps<=0||e.tps>=opts.minTps)&&
    (opts.maxLatencySeconds<=0||e.ttftMs<=opts.maxLatencySeconds*1000));
  // Soft requirements: if none meet both, retain the best measured value.
  const preferredTags=new Set(preferred.map(e=>e.tag));
  return ranked.sort((a,b)=>(Number(preferredTags.has(b.tag))-Number(preferredTags.has(a.tag)))||a.score-b.score||a.expectedCostUsd-b.expectedCostUsd||a.tag.localeCompare(b.tag));
}

export class WarmEndpointChoices {
  readonly entries = new Map<string,{tag:string;at:number}>();
  choose(key: string, ranked: RankedEndpoint[], now=Date.now(), healthy:(e:RankedEndpoint)=>boolean=()=>true): RankedEndpoint|undefined {
    const warm=this.entries.get(key);
    const retained=warm&&now-warm.at<600_000?ranked.find(e=>e.tag===warm.tag&&healthy(e)):undefined;
    const selected=retained??ranked[0];
    if(selected){this.entries.delete(key);this.entries.set(key,{tag:selected.tag,at:now});}
    if(this.entries.size>256)this.entries.delete(this.entries.keys().next().value!);
    return selected;
  }
}

const catalogs = new Map<string,{at:number;endpoints:ProviderEndpoint[]}>();
const pending = new Map<string,Promise<void>>();
const lastAttempt=new Map<string,number>();
let observations: ProviderObservation[]|undefined, observationRoot="";
const choices=new WarmEndpointChoices();let choiceFile="",lastSave=0;
const selectedBySession=new Map<string,string>();
function loadLocalData() {
  const file=globalPath("cache_usage.jsonl");
  if(observations&&observationRoot===file)return;
  observationRoot=file;observations=[];
  try { const fd=fs.openSync(file,"r");try{const size=fs.fstatSync(fd).size,start=Math.max(0,size-2*1024*1024),buf=Buffer.alloc(size-start);fs.readSync(fd,buf,0,buf.length,start);let text=buf.toString("utf8");if(start)text=text.slice(text.indexOf("\n")+1);
    observations=text.split("\n").flatMap(line=>{try{const r=JSON.parse(line);return Date.now()-Date.parse(r.ts)<86_400_000?[r]:[];}catch{return [];}}).slice(-1000);
  }finally{fs.closeSync(fd);}}catch{/* first installation */}
  const nextFile=globalPath("provider_endpoint_routes.json");
  if(nextFile!==choiceFile){choiceFile=nextFile;choices.entries.clear();try{for(const [k,v] of Object.entries(JSON.parse(fs.readFileSync(choiceFile,"utf8")))){const e=v as {tag:string;at:number};if(typeof e.tag==="string"&&positive(e.at)&&Date.now()-e.at<600_000)choices.entries.set(k,e);}}catch{/* first route */}}
}
export async function warmProviderValueCatalog(model: string, apiKey?:string): Promise<void> {
  loadLocalData();
  if(catalogs.has(model)&&Date.now()-catalogs.get(model)!.at<300_000)return;
  const existing=pending.get(model);if(existing)return existing;
  if(Date.now()-(lastAttempt.get(model)??0)<30_000)return;
  lastAttempt.set(model,Date.now());
  const request=(async()=>{try{
    const parts=model.replace(/:(?:free|nitro|floor)$/i,"").split("/");if(parts.length!==2)return;
    const response=await fetch(`https://openrouter.ai/api/v1/models/${parts.map(encodeURIComponent).join("/")}/endpoints`,{signal:AbortSignal.timeout(1500),headers:apiKey?{Authorization:`Bearer ${apiKey}`}:{}});
    if(!response.ok)return;const body=await response.json() as {data?:{endpoints?:ProviderEndpoint[]}};
    if(Array.isArray(body.data?.endpoints))catalogs.set(model,{at:Date.now(),endpoints:body.data.endpoints});
  }catch{/* native routing remains available */}})();pending.set(model,request);
  try{await request;}finally{pending.delete(model);}
}
export function observeProviderPerformance(row: ProviderObservation) {
  loadLocalData();observations!.push(row);if(observations!.length>1000)observations!.shift();
}
export function selectProviderValueEndpoint(opts: Parameters<typeof rankProviderEndpoints>[2] & {sessionId:string;policy:unknown}): RankedEndpoint|undefined {
  loadLocalData();const catalog=catalogs.get(opts.model);if(!catalog)return;
  const ranked=rankProviderEndpoints(catalog.endpoints,observations!,opts);
  const key=createHash("sha256").update(JSON.stringify([opts.sessionId,opts.model,opts.policy])).digest("hex");
  const before=choices.entries.get(key)?.tag,selected=choices.choose(key,ranked,Date.now(),e=>
    (opts.minTps<=0||e.tps>=opts.minTps*.6)&&(opts.maxLatencySeconds<=0||e.ttftMs<=Math.max(3000,opts.maxLatencySeconds*3000)));
  if(selected){selectedBySession.set(`${opts.model}:${opts.sessionId}`,selected.tag);if(selectedBySession.size>256)selectedBySession.delete(selectedBySession.keys().next().value!);}
  if(selected&&(before!==selected.tag||Date.now()-lastSave>60_000))try{
    fs.mkdirSync(path.dirname(choiceFile),{recursive:true});const temp=choiceFile+".tmp";fs.writeFileSync(temp,JSON.stringify(Object.fromEntries(choices.entries)));fs.renameSync(temp,choiceFile);lastSave=Date.now();
  }catch{/* route persistence must not prevent inference */}
  return selected;
}
export function selectedProviderEndpoint(model:string,sessionId:string,provider:string|null):string|undefined {
  const endpoints=catalogs.get(model)?.endpoints??[];
  const tag=selectedBySession.get(`${model}:${sessionId}`);
  return endpoints.find(p=>p.tag===tag&&normalize(p.provider_name)===normalize(provider??""))?.tag;
}
