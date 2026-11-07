import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {modelSupportsNativeVisionAsync,type AgentHarness,type ToolResult} from '@liminal/core';
import {defineTool} from '../../shared/helpers.js';

const mimeTypes:Record<string,string>={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
const maxBytes=4*1024*1024;

/** Native tool pixels go to the next main-model request, after the entire tool batch. */
export async function attachNativeImage(harness:AgentHarness,input:string,note:string,key='uploaded-image'):Promise<ToolResult>{
 if(!await modelSupportsNativeVisionAsync(harness.config.model,harness.config.baseURL))return {ok:false,error:'IMAGE_INPUT_UNAVAILABLE: The selected chat model has no confirmed image input support. Choose an image-capable model or configure native image support for your local model. No secondary model was called.'};
 let dataUrl:string,source:string;
 if(input.startsWith('data:image/')){
  const parsed=input.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!parsed||Buffer.byteLength(parsed[2]!,'base64')>maxBytes)return {ok:false,error:'Invalid or oversized image data; maximum 4 MB.'};
  dataUrl=input;source='image payload';
 }else{
  const file=resolve(input),mime=mimeTypes[extname(file).toLowerCase()];
  if(!mime)return {ok:false,error:'Supported image files: JPEG, PNG, GIF, WebP.'};
  let bytes:Buffer;try{
   const info=await stat(file);
   if(!info.isFile()||!info.size||info.size>maxBytes)return {ok:false,error:'Image must be a regular file between 1 byte and 4 MB.'};
   bytes=await readFile(file);
  }catch{return {ok:false,error:'Image file could not be read: '+file};}
  if(!bytes.length||bytes.length>maxBytes)return {ok:false,error:'Image must contain data and be no larger than 4 MB.'};
  dataUrl=`data:${mime};base64,${bytes.toString('base64')}`;source=file;
 }
 harness.getContext().setImageObservation(key,note||'Image from '+source,dataUrl);
 return {ok:true,output:'NATIVE_IMAGE_ATTACHED: '+source+'. Pixels will be included in the next active chat-model request; no separate analysis call.'};
}

export function createUploadImageTool(harness:AgentHarness){
 return defineTool({name:'upload_image',description:'Load a local image file or image data URL into the active chat model’s native visual context. No separate model or analysis request. Browser screenshots are attached automatically. Supports JPEG, PNG, GIF, WebP up to 4 MB.',requiresApproval:false,
  parameters:{type:'object',properties:{path:{type:'string',description:'Image file path or data:image/...;base64 URL'},note:{type:'string',description:'Optional description of the image or question'}},required:['path'],additionalProperties:false},
  handler:async args=>attachNativeImage(harness,String(args.path??''),String(args.note??''))});
}
