import {createHash} from 'node:crypto';
import {modelSupportsNativeVisionAsync,type AgentHarness,type ToolResult} from '@liminal/core';
import {browserWorkspaceState,getBrowserSession,checkBrowserSessionOwner,applyScreencastFrame,clearBrowserPanelFrame} from './browser_runtime.js';
import {attachNativeImage} from '../vision/upload_image.js';
import {browserScreenshotPrivacyStyle} from './browser_screenshot_privacy.js';

const visualTools=new Set(['browser_open','browser_navigate','browser_search','browser_act','browser_snapshot','browser_wait_for']);
const previous=new WeakMap<AgentHarness,Map<string,{hash:string,url:string}>>();
/** A focused crop can replace the viewport under the same context image key. */
export function invalidateBrowserImage(harness:AgentHarness|undefined,sessionId:string):void{if(harness)previous.get(harness)?.delete('browser:'+sessionId);}

/** Observe the resulting page once per outer browser operation. No inference call. */
export async function attachBrowserImage(harness:AgentHarness|undefined,toolName:string,result:ToolResult):Promise<ToolResult>{
 if(!harness?.config||!visualTools.has(toolName))return result;
 if(!await modelSupportsNativeVisionAsync(harness.config.model,harness.config.baseURL)){
  return result.ok?{...result,output:result.output+'\nNATIVE_BROWSER_IMAGE: unavailable for this model; DOM/accessibility evidence only.'}:result;
 }
 const id=browserWorkspaceState(harness.taskId).selectedTabId;
 const session=id?getBrowserSession(id):undefined;
 if(!session||!id||checkBrowserSessionOwner(id,harness.taskId)||session.page.isClosed())return result;
 try{
  const page=session.page,url=page.url();
  clearBrowserPanelFrame(id);
  const bytes=await page.screenshot({type:'jpeg',quality:65,scale:'css',fullPage:false,style:browserScreenshotPrivacyStyle,timeout:5000});
  // Reuse these already masked pixels for previews/recording; a second CDP
  // screencast or screenshot request can contend with native WebView capture.
  applyScreencastFrame(id,bytes);
  const key='browser:'+id,hash=createHash('sha256').update(bytes).digest('hex');
  let known=previous.get(harness);if(!known){known=new Map();previous.set(harness,known);}
  const old=known.get(key);
  if(old?.hash!==hash||old.url!==url||!harness.getContext().hasImageObservation(key)){
   const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
   const attached=await attachNativeImage(harness,'data:image/jpeg;base64,'+bytes.toString('base64'),`${toolName} resulting viewport\nURL: ${url}\nObserved: ${new Date().toISOString()}\nViewport: ${viewport.width} × ${viewport.height} CSS pixels; click_at uses this coordinate space.\nRecognized password fields are masked.`,key);
   if(!attached.ok){harness.getContext().removeImageObservation(key);known.delete(key);clearBrowserPanelFrame(id);return result.ok?{...result,output:result.output+'\nNATIVE_BROWSER_IMAGE_UNAVAILABLE: '+attached.error}:result;}
   known.delete(key);known.set(key,{hash,url});while(known.size>2)known.delete(known.keys().next().value!);
  }
  harness.getContext().promoteImageObservation(key);
  return result.ok?{...result,output:result.output+'\nNATIVE_BROWSER_IMAGE: current viewport attached to the next main-model request.'}:{...result,error:result.error+'\nNATIVE_BROWSER_IMAGE: current viewport attached to the next main-model request.'};
 }catch{
  harness.getContext().removeImageObservation('browser:'+id);previous.get(harness)?.delete('browser:'+id);clearBrowserPanelFrame(id);
  const note='\nNATIVE_BROWSER_IMAGE_UNAVAILABLE: screenshot capture failed; the previous image has been removed. Use the current text/refs, not old screenshot coordinates.';
  return result.ok?{...result,output:result.output+note}:{...result,error:result.error+note};
 }
}
