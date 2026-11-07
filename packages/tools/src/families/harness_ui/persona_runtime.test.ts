import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHarness } from "@liminal/core";
import type { PersonaProfile } from "./persona_presets.js";
import { createAppendPersonaLivingTool } from "./append_persona_living.js";

let prevWorkspace: string | undefined;
let prevGlobalRoot: string | undefined;

beforeEach(() => {
  prevWorkspace = process.env.AGENT_WORKSPACE_ROOT;
  prevGlobalRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
});

afterEach(async () => {
  if (prevWorkspace === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
  else process.env.AGENT_WORKSPACE_ROOT = prevWorkspace;
  if (prevGlobalRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
  else process.env.AGENT_GLOBAL_STORAGE_ROOT = prevGlobalRoot;
});

const minimalProfile: PersonaProfile = {
  name: "Test Voice",
  coreIdentity: "A concise test identity for harness block assembly and soul reload wiring.",
  background: "Grounding line one. Grounding line two for tests.",
  selfImage: "Sees itself as careful and precise under uncertainty.",
  speechStyle: {
    sentenceStructure: "Short leads; bullets for lists.",
    formality: "casual",
    register: "Plain technical diction — constraints, tradeoffs, signal; maps-and-weights imagery; steady and direct.",
    avoidWords: ["delve", "synergy", "happy to help", "leverage"],
    rhythm: "Staccato opens, tight closes.",
  },
  tone: {
    confidence: 6,
    humorStyle: "Dry",
    aggression: 3,
    emotionalFlavor: "focused",
    posture: "Collaborative, direct.",
  },
  thinkingStyle: "Prefers explicit assumptions and falsifiable checks when diagnosing.",
  decisionFramework: "Maps risk and reversibility before committing to a path.",
  neverDo: ["Use asterisk actions", "Write theatrical monologues", "Invent specifics"],
  alwaysDo: [
    "Stay accurate with facts: label guesses",
    "Name inference boundaries",
    "Ask when underspecified",
  ],
  strength: 7,
};

test("loadPersonaArtifactsContext removes stale monolithic soul.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const { getPersonaArtifactsPaths, loadPersonaArtifactsContext } = await import("./persona_runtime.js");
  const paths = getPersonaArtifactsPaths();
  await mkdir(paths.dir, { recursive: true });
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.staleMonolithicSoulMd, "# old monolith\n", "utf8");
  await writeFile(paths.identityPath, "# Identity Core\n\nok\n", "utf8");
  await loadPersonaArtifactsContext();
  await assert.rejects(async () => readFile(paths.staleMonolithicSoulMd, "utf8"));
  await rm(root, { recursive: true, force: true });
});

test("buildPersonaSoulMarkdownFromSlices orders living after canonical slices", async () => {
  const { buildPersonaSoulMarkdownFromSlices } = await import("./persona_runtime.js");
  const md = buildPersonaSoulMarkdownFromSlices({
    identity: "# Identity Core\nA",
    voice: "# Voice DNA\nB",
    stance: "# Cognitive stance\nC",
    rails: "# Behavioral rails\nD",
    living: "tail-note",
  })!;
  const idxLiving = md.indexOf("PERSONA LIVING NOTES");
  const idxRails = md.indexOf("# Behavioral rails");
  const idxIdentity = md.indexOf("# Identity Core");
  assert.ok(idxIdentity >= 0 && idxRails >= 0 && idxLiving >= 0);
  assert.ok(idxIdentity < idxRails && idxRails < idxLiving);
  assert.match(md, /tail-note/);
});

test("appendPersonaLivingSection rejects oversized notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const mod = await import("./persona_runtime.js");
  const paths = mod.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nx\n", "utf8");
  const big = "a".repeat(mod.PERSONA_LIVING_MAX_APPEND_CHARS + 10);
  const r = await mod.appendPersonaLivingSection(big);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /max length/i);
});

test("appendPersonaLivingSection eventually trims head when over file cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const mod = await import("./persona_runtime.js");
  const paths = mod.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nx\n", "utf8");
  let sawTrim = false;
  for (let i = 0; i < 120; i++) {
    const chunk = `${"b".repeat(800)}MARK_${i}\n`;
    const r = await mod.appendPersonaLivingSection(chunk);
    assert.equal(r.ok, true);
    if (r.trimmedHead) {
      sawTrim = true;
      break;
    }
  }
  assert.equal(sawTrim, true);
  const final = await readFile(paths.livingPath, "utf8");
  assert.ok(final.length <= mod.PERSONA_LIVING_MAX_FILE_CHARS + 800);
});

test("applyPersonaProfileToHarness includes living slice in persona block", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const rt = await import("./persona_runtime.js");
  const paths = rt.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\nid\n", "utf8");
  await writeFile(paths.livingPath, "# Persona living notes\n\nhello-living\n", "utf8");
  let block = "";
  const harness = {
    setPersona(_cfg: unknown, b: string, supplement = "") {
      block = b + supplement;
    },
  } as unknown as AgentHarness;
  await rt.applyPersonaProfileToHarness(harness, minimalProfile);
  assert.match(block, /PERSONA LIVING NOTES/);
  assert.match(block, /hello-living/);
});

test("append_persona_living tool reloads harness via setPersona", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const rt = await import("./persona_runtime.js");
  const paths = rt.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nid\n", "utf8");
  await writeFile(paths.runtimeProfilePath, JSON.stringify(minimalProfile), "utf8");
  await writeFile(paths.livingPath, "# Persona living notes\n\nseed\n", "utf8");

  let blocks: string[] = [];
  const harness = {
    getPersistedPersonaProfile: () => undefined,
    setPersona(_cfg: unknown, b: string, supplement = "") {
      blocks.push(b + supplement);
    },
  } as unknown as AgentHarness;

  const tool = createAppendPersonaLivingTool(harness);
  const out = (await tool.handler({ note: "new-lesson" })) as { ok?: boolean; output?: string };
  assert.equal(out.ok, true);
  assert.match(out.output ?? "", /reloaded/i);
  assert.ok(blocks.length >= 1);
  assert.match(blocks[blocks.length - 1]!, /new-lesson/);
  await rm(root, { recursive: true, force: true });
});


test('verified first-run generation uses one draft, keeps the theme and writes complete artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'liminal-persona-flow-'));
 process.env.AGENT_WORKSPACE_ROOT=root;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 const original=globalThis.fetch;let checks=0,drafts=0;
 const {generatePersonaFromInput,getPersonaArtifactsPaths}=await import('./persona_runtime.js');
 const {setPersonaGeneratorTestHooks}=await import('./persona_generator.js');
 const {LIMINAL_DEFAULT_UI_THEME}=await import('./persona_default.js');
 try{
  globalThis.fetch=async()=>{checks++;return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'connection_check',arguments:'{"ready":true}'}}]}}]}));};
  setPersonaGeneratorTestHooks({callPersonaModel:async()=>{drafts++;return {...minimalProfile,neverDo:[],alwaysDo:[],speechStyle:{...minimalProfile.speechStyle,avoidWords:[]}};}});
  const paths=getPersonaArtifactsPaths();await mkdir(paths.dir,{recursive:true});
  await writeFile(paths.uiThemePath,JSON.stringify({...LIMINAL_DEFAULT_UI_THEME,accent:'#fca5a5'}));
  const harness={config:{openRouterApiKey:'synthetic-flow-key',model:'fixture/model',baseURL:'https://fixture.example/v1'},registry:{getAll:()=>[]},
    getRuntimePreferences:()=>({version:1,updatedAt:0,harness:{env:{AGENT_PERSONA_UI_THEME_LLM:'0',AGENT_PERSONA_UI_COPY:'0',AGENT_PERSONA_SOUL_MODE:'scaffold'}}})} as unknown as AgentHarness;
  const bundle=await generatePersonaFromInput(harness,'Warm patient botanist named Fern',5);
  assert.equal(checks,1);assert.equal(drafts,1);assert.deepEqual(bundle.profile.neverDo,[]);
  assert.equal(JSON.parse(await readFile(paths.uiThemePath,'utf8')).accent,'#fca5a5');
  for(const file of [paths.runtimeProfilePath,paths.identityPath,paths.voicePath,paths.stancePath,paths.railsPath,paths.manifestPath,paths.uiCopyPath])assert.ok((await readFile(file,'utf8')).length>0);
  await generatePersonaFromInput(harness,'Warm patient botanist named Fern',5);
  assert.equal(checks,1,'unchanged verified model needs no additional preflight');assert.equal(drafts,2);
 }finally{globalThis.fetch=original;setPersonaGeneratorTestHooks(undefined);await rm(root,{recursive:true,force:true});}
});


test('streaming first-run verifies the local model before publishing persona artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'liminal-persona-stream-'));process.env.AGENT_WORKSPACE_ROOT=root;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 const requests:{stream:boolean;tools:boolean;model:string}[]=[];
 const profile={...minimalProfile,neverDo:[],alwaysDo:[],speechStyle:{...minimalProfile.speechStyle,avoidWords:[]}};
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  requests.push({stream:body.stream===true,tools:!!body.tools,model:body.model});
  if(body.tools){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'connection_check',arguments:'{"ready":true}'}}]}}]}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const json=JSON.stringify(profile);
  for(let offset=0;offset<json.length;offset+=180)res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:json.slice(offset,offset+180)}}]})+'\n\n');
  res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const harness={config:{openRouterApiKey:'liminal-local',model:'fixture/local',baseURL:`http://127.0.0.1:${address.port}/v1`},registry:{getAll:()=>[]},
    getRuntimePreferences:()=>({version:1,updatedAt:0,harness:{env:{AGENT_PERSONA_UI_THEME_LLM:'0',AGENT_PERSONA_UI_COPY:'0',AGENT_PERSONA_SOUL_MODE:'scaffold',AGENT_PERSONA_GENERATION_STREAM:'1'}}})} as unknown as AgentHarness;
  const {generatePersonaFromInput,getPersonaArtifactsPaths}=await import('./persona_runtime.js');
  const events:string[]=[];
  const result=await generatePersonaFromInput(harness,'Patient botanist named Fern',5,undefined,(stage)=>events.push(stage));
  assert.equal(result.profile.strength,5);
  assert.deepEqual(requests,[{stream:false,tools:true,model:'fixture/local'},{stream:true,tools:false,model:'fixture/local'}]);
  const paths=getPersonaArtifactsPaths();assert.equal(JSON.parse(await readFile(paths.runtimeProfilePath,'utf8')).name,'Fern');
  assert.ok(events.includes('verifying_provider'));assert.ok(events.includes('artifact_ready'));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
