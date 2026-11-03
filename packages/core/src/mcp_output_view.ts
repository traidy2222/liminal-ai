import {createHash} from 'node:crypto';
import {MAX_ARTIFACT_BYTES,writeArtifact} from './output_distill.js';

const INLINE_MCP_CHARS = 64_000;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function short(value: unknown, maximum = 256): string | undefined {
  return typeof value === 'string' ? value.slice(0, maximum) : undefined;
}
function summary(value: unknown): Record<string, unknown> {
  if(Array.isArray(value))return{type:'array',items:value.length};
  if(object(value)){const keys=Object.keys(value);return{type:'object',keys:keys.filter(key=>key.length<=256).slice(0,32),total_keys:keys.length};}
  if(typeof value==='string')return{type:'string',characters:value.length};
  return{type:value===null?'null':typeof value};
}

/** A context view, never a replacement canonical MCP record. The full original
 * response remains in the trace/index and a SHA-256-addressed local artifact.
 */
export async function archiveLargeMcpOutput(tool: string, output: string): Promise<string | null> {
  if(!tool.startsWith('mcp_'))return null;
  let parsed:unknown;let json=true;
  try{parsed=JSON.parse(output);}catch{json=false;}
  const root=object(parsed)?parsed:undefined;
  const normalized=root?.normalized_result;
  const canonicalCode=object(normalized)&&typeof normalized.pseudocode==='string'?normalized.pseudocode:
    root?.operation==='procedure_pseudo_code'&&typeof normalized==='string'?normalized:undefined;
  if(output.length<=INLINE_MCP_CHARS&&!canonicalCode)return null;
  const hash=createHash('sha256').update(output).digest('hex');
  const canReadArtifact=Buffer.byteLength(output)<=MAX_ARTIFACT_BYTES;
  const pointer=await writeArtifact(hash,output);
  let verbatim:Record<string,unknown>|undefined;
  if(canonicalCode){const codeHash=createHash('sha256').update(canonicalCode).digest('hex');const file=await writeArtifact(codeHash,canonicalCode);
    verbatim={path:file,sha256:codeHash,characters:canonicalCode.length,evidence_id:root?.evidence_id,
      source_json_pointer:object(normalized)?'/normalized_result/pseudocode':'/normalized_result',
      save:'Use copy_file from this path to the requested code file. Copy the exact bytes; do not retype, rename identifiers or reconstruct pseudocode from this preview.'};}
  const fields=root?Object.fromEntries(Object.entries(root).slice(0,32).filter(([key])=>key.length<=256).map(([key,value])=>[key,summary(value)])):undefined;
  const evidence=root?.evidence_id;
  const suggested=object(normalized)&&typeof normalized.pseudocode==='string'?'/normalized_result/pseudocode':root&&Object.hasOwn(root,'normalized_result')?'/normalized_result':root&&Object.hasOwn(root,'result')?'/result':'';
  const selected=object(normalized)&&typeof normalized.pseudocode==='string'?normalized.pseudocode:root&&Object.hasOwn(root,'normalized_result')?normalized:root&&Object.hasOwn(root,'result')?root.result:parsed;
  const session=tool.endsWith('_binary_session')&&object(root?.result)?root.result:undefined;
  const available=session&&Array.isArray(session.capabilities)?session.capabilities.slice(0,512).filter(item=>object(item)&&item.available===true&&typeof item.operation==='string').slice(0,64).map(item=>short((item as Record<string,unknown>).operation,128)):undefined;
  const binding=object(session?.analysis_provider_binding)?session.analysis_provider_binding:undefined;
  const provider=object(binding?.provider)?binding.provider:undefined;
  const profile=object(binding?.analysis_profile)?binding.analysis_profile:undefined;
  return JSON.stringify({
    kind:'archived_mcp_result',source_tool:tool,full_response_retained:true,sha256:hash,
    original_characters:output.length,original_bytes:Buffer.byteLength(output),full_text_pointer:pointer,
    ...(verbatim?{verbatim_code_artifact:verbatim,pseudocode_preview:canonicalCode!.slice(0,4000),pseudocode_preview_complete:canonicalCode!.length<=4000}:{}),
    ...(session?{native_session_observation:{open:typeof session.open==='boolean'?session.open:undefined,path:short(session.path,2048),sha256:short(session.sha256,64),architecture:short(session.architecture,64),format:short(session.format,64),analysis_provider_binding:binding?{provider:provider?{id:short(provider.id),name:short(provider.name),version:short(provider.version)}:undefined,profile_digest:short(profile?.digest,128)}:undefined,available_native_operations:available,note:'These are the native operations this session reported available. Target-free services may have separate availability. Do not assume IDA supports every catalog operation.'}}:{}),
    ...(json?{json_root:summary(parsed),fields,
      ...(typeof evidence==='string'&&evidence.length<=128?{evidence_id:evidence}:{}),
      ...(canReadArtifact?{read_artifact:{hash,json_pointer:suggested,view:'value',offset:0,
        ...(typeof selected==='string'?{}:{limit:20})},
      keys_view:{hash,json_pointer:'',view:'keys'}}:{artifact_access:{read_artifact_available:false,reason:`Full response exceeds read_artifact's ${MAX_ARTIFACT_BYTES}-byte load limit. Use bounded local file inspection of full_text_pointer or the exact code artifact. Do not repeat the producer operation to retrieve evidence already saved.`}}),
      note:'This is a harness view of a complete archived response. Use the actual root keys and JSON pointers; do not assume a result wrapper or rerun the producer to retrieve saved evidence.',
    }:{text_preview:output.slice(0,1600),...(canReadArtifact?{read_artifact:{hash,start_line:1,end_line:40}}:{artifact_access:{read_artifact_available:false,reason:'Response exceeds the artifact load limit; inspect full_text_pointer with bounded local file reads.'}}),note:'Non-JSON MCP text is retained in full. This preview is incomplete.'}),
  },null,2);
}
