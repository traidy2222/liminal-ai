import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {globalPath} from './global_storage.js';
import {resolveProviderConfig} from './provider_config.js';
import {isKimchiApiBaseUrl} from './kimchi_constants.js';
import {isOpenRouterApiBaseUrl} from './provider_urls.js';
import type {RuntimePreferences} from './runtime_prefs.js';

export const UNCONFIGURED_PROVIDER_KEY='liminal-provider-not-configured';
export function providerConnectionConfigured(key:string|undefined):boolean{return !!key?.trim()&&key!==UNCONFIGURED_PROVIDER_KEY;}
export function isLocalProviderUrl(value:string):boolean{
 try{const u=new URL(value),h=u.hostname.replace(/^\[|\]$/g,'');return ['http:','https:'].includes(u.protocol)&&(h==='localhost'||h==='::1'||isIP(h)===4&&(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)));}catch{return false;}
}
export interface ProviderSetupInput{apiKey?:string;model?:string;baseURL?:string}
export function normalizeProviderSetup(input:ProviderSetupInput){
 const raw=input.baseURL?.trim()||'https://openrouter.ai/api/v1';let u:URL;
 try{u=new URL(raw);}catch{throw Error('Enter a valid API endpoint URL.');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Use an HTTP(S) API endpoint without credentials, query parameters or fragments.');
 if(u.protocol==='http:'&&!isLocalProviderUrl(raw))throw Error('Cloud endpoints must use HTTPS.');
 const baseURL=u.href.replace(/\/+$/,'');const model=input.model?.trim()??'';
 let apiKey=input.apiKey?.trim()??'';
 if(/[\s"'\\]/.test(apiKey)||apiKey.length>8192)throw Error('Invalid API key. Paste the key without quotes or whitespace.');
 if(!apiKey){
  const configured=(process.env.AGENT_API_BASE_URL||'https://openrouter.ai/api/v1').trim().replace(/\/+$/,'');
  if(isLocalProviderUrl(baseURL)){try{apiKey=resolveProviderConfig({baseURL,model:model||undefined}).apiKey;}catch{}}
  else if(isOpenRouterApiBaseUrl(baseURL))apiKey=process.env.OPENROUTER_API_KEY?.trim()|| (configured===baseURL?process.env.AGENT_API_KEY?.trim():'')||'';
  else if(isKimchiApiBaseUrl(baseURL))apiKey=process.env.KIMCHI_API_KEY?.trim()||process.env.CASTAI_API_KEY?.trim()||(configured===baseURL?process.env.AGENT_API_KEY?.trim():'')||'';
  else if(configured===baseURL)apiKey=process.env.AGENT_API_KEY?.trim()||'';
 }
 if(!apiKey&&isLocalProviderUrl(baseURL))apiKey='liminal-local';
 return {baseURL,model,apiKey,local:isLocalProviderUrl(baseURL)};
}
async function request(baseURL:string,route:string,key:string,body?:unknown){
 let response:Response;
 try{response=await fetch(baseURL+route,{method:body?'POST':'GET',headers:{...(key?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?45000:10000)});}catch{throw Error('Cannot reach the model server. Check the endpoint and start/load your local server if needed.');}
 if(!response.ok)throw Error(response.status===401||response.status===403?'The provider rejected these credentials. Check your API key.':response.status===402?'The provider requires credits before it can run this model.':`The provider returned HTTP ${response.status}. Check the selected model and endpoint.`);
 try{return await response.json() as any;}catch{throw Error('The endpoint did not return an OpenAI-compatible response.');}
}
export async function discoverProviderModels(input:ProviderSetupInput){
 const cfg=normalizeProviderSetup(input);const data=await request(cfg.baseURL,'/models',cfg.apiKey);
 const models=(Array.isArray(data.data)?data.data:[]).filter((m:any)=>typeof m.id==='string').map((m:any)=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,toolCalling:Array.isArray(m.supported_parameters)?m.supported_parameters.includes('tools'):null}));
 if(!models.length)throw Error('No models are available. Load a model in your local server, then refresh.');
 return {models,local:cfg.local};
}
export async function validateProviderSetup(input:ProviderSetupInput){
 const cfg=normalizeProviderSetup(input);
 if(!cfg.model)throw Error('Select or enter a model.');
 if(!cfg.local&&!cfg.apiKey)throw Error('Enter your cloud provider API key.');
 const data=await request(cfg.baseURL,'/chat/completions',cfg.apiKey,{model:cfg.model,messages:[{role:'user',content:'Call connection_check with ready=true.'}],tools:[{type:'function',function:{name:'connection_check',description:'Confirm this model can call tools.',parameters:{type:'object',properties:{ready:{type:'boolean'}},required:['ready'],additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'connection_check'}},max_tokens:256,stream:false});
 const call=data.choices?.[0]?.message?.tool_calls?.find((c:any)=>c.function?.name==='connection_check');
 let ready=false;try{ready=JSON.parse(call?.function?.arguments??'{}').ready===true;}catch{}
 if(!ready)throw Error('The model responded but did not complete the tool-call check. Choose a tool-capable model.');
 return cfg;
}
let credentialWrite=Promise.resolve();
export async function persistValidatedProvider(cfg:Awaited<ReturnType<typeof validateProviderSetup>>):Promise<Partial<RuntimePreferences>>{
 const envKey=cfg.local?'AGENT_LOCAL_API_KEY':isOpenRouterApiBaseUrl(cfg.baseURL)?'OPENROUTER_API_KEY':isKimchiApiBaseUrl(cfg.baseURL)?'KIMCHI_API_KEY':'AGENT_API_KEY';
 if(cfg.apiKey&&cfg.apiKey!=='liminal-local'){
  const save=credentialWrite.catch(()=>{}).then(async()=>{
   const target=globalPath('.env');await mkdir(path.dirname(target),{recursive:true});let text=await readFile(target,'utf8').catch(()=>'');
   const values:Record<string,string>={[envKey]:cfg.apiKey,...(envKey==='AGENT_API_KEY'?{AGENT_API_BASE_URL:cfg.baseURL}:{})};
   for(const [key,value]of Object.entries(values)){const line=key+'='+JSON.stringify(value),pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,()=>line):text.trimEnd()+'\n'+line+'\n';}
   const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,target);
   Object.assign(process.env,values);
  });credentialWrite=save;await save;
 }
 return {provider:{baseURL:cfg.baseURL,model:cfg.model,inferenceMode:'byok'},harness:{env:{AGENT_INFERENCE_MODE:'byok',AGENT_INFERENCE_PREFER_MANAGED:'0',AGENT_API_BASE_URL:cfg.baseURL,AGENT_MODEL:cfg.model,AGENT_SINGLE_MODEL:'1',AGENT_FAST_MODEL:cfg.model,AGENT_PERSONA_INFER_MODEL:cfg.model}}};
}
