import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runWithWorkspaceRoot} from './workspace_root.js';
import {archiveLargeMcpOutput} from './mcp_output_view.js';

test('large MCP evidence keeps exact UTF-8 and exposes the actual pseudocode path',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mcp-view-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const full=JSON.stringify({evidence_id:'ev_'+ 'a'.repeat(64),raw_result:{observations:['漢字🙂'.repeat(20000)]},normalized_result:{pseudocode:'int main(){return 0;}'},limitations:['No runtime execution observed']});
 await runWithWorkspaceRoot(root,async()=>{
  const rendered=await archiveLargeMcpOutput('mcp_fixture_analyze',full);assert(rendered);assert(Buffer.byteLength(rendered)<12000);
  const view=JSON.parse(rendered);assert.equal(view.read_artifact.json_pointer,'/normalized_result/pseudocode');assert.equal(view.evidence_id,'ev_'+'a'.repeat(64));assert.equal(view.fields.raw_result.type,'object');
  assert.equal(view.sha256,createHash('sha256').update(full).digest('hex'));assert.equal(await fs.readFile(view.full_text_pointer,'utf8'),full);
 });
});

test('small and non-MCP outputs stay inline; non-JSON MCP has an explicit incomplete preview',async(t)=>{
 assert.equal(await archiveLargeMcpOutput('mcp_fixture_read','small'),null);assert.equal(await archiveLargeMcpOutput('read_file','x'.repeat(100000)),null);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mcp-view-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 await runWithWorkspaceRoot(root,async()=>{const full='not JSON\n'.repeat(10000);const result=JSON.parse((await archiveLargeMcpOutput('mcp_fixture_read',full))!);assert.match(result.note,/incomplete/);assert.equal(await fs.readFile(result.full_text_pointer,'utf8'),full);});
});

test('even small native pseudocode gets an exact source artifact rather than a retyped deliverable',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mcp-view-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 await runWithWorkspaceRoot(root,async()=>{const code='int WinMain(){ return GetModuleHandleA(0) != 0; }\n';const full=JSON.stringify({evidence_id:'ev_'+'b'.repeat(64),operation:'procedure_pseudo_code',normalized_result:code});const view=JSON.parse((await archiveLargeMcpOutput('mcp_fixture_procedure_pseudo_code',full))!);assert.equal(await fs.readFile(view.verbatim_code_artifact.path,'utf8'),code);assert.equal(view.verbatim_code_artifact.sha256,createHash('sha256').update(code).digest('hex'));assert.equal(view.read_artifact.view,'value');assert.equal(view.read_artifact.limit,undefined);assert.equal(await fs.readFile(view.full_text_pointer,'utf8'),full);});
});


test('oversized session fields cannot escape the bounded archived summary',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mcp-view-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 await runWithWorkspaceRoot(root,async()=>{const full=JSON.stringify({result:{open:true,path:'x'.repeat(100000),analysis_provider_binding:{provider:{id:'ida',name:'y'.repeat(100000)},untrusted:'z'.repeat(100000)},capabilities:[{available:true,operation:'op'.repeat(100000)}]}});const rendered=(await archiveLargeMcpOutput('mcp_fixture_binary_session',full))!;assert(Buffer.byteLength(rendered)<12000);const view=JSON.parse(rendered);assert.equal(view.native_session_observation.path.length,2048);assert.equal(view.native_session_observation.available_native_operations[0].length,128);assert.equal(view.native_session_observation.analysis_provider_binding.provider.name.length,256);});
});

test('responses over the artifact load limit retain exact evidence without unusable read instructions',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mcp-view-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 await runWithWorkspaceRoot(root,async()=>{const full=JSON.stringify({result:'x'.repeat(12000001)});const view=JSON.parse((await archiveLargeMcpOutput('mcp_fixture_inspect',full))!);assert.equal(view.read_artifact,undefined);assert.equal(view.artifact_access.read_artifact_available,false);assert.equal(await fs.readFile(view.full_text_pointer,'utf8'),full);});
});
