import {randomUUID} from 'node:crypto';
import type {Page} from 'playwright';

/** Observe URLs supplied by this page's copy operation during an action.
 * Never read the OS clipboard; preserve the site's original clipboard calls. */
export async function observeBrowserCopyLinks(page:Page){
 let frames: ReturnType<Page['frames']>;
 try{frames=page.frames();}catch{return async()=>[] as string[];}
 const key='__liminal_copy_'+randomUUID().replaceAll('-','');
 await Promise.all(frames.map(frame=>frame.evaluate(key=>{
  const links:string[]=[];
  const record=(text:string)=>{
   if(typeof text!=='string'||text.length>16000)return;
   const trimmed=text.trim(),markdown=trimmed.match(/^\[[^\]]*\]\((?:<([^>]+)>|(.+))\)$/s);
   const candidate=markdown?.[1]??markdown?.[2]??trimmed;
   if(!candidate.match(/^[a-z][a-z\d+.-]*:\/\//i))return;
   try{const url=new URL(candidate);if(['data:','javascript:','file:','blob:'].includes(url.protocol)||url.username||url.password)return;if(!links.includes(url.href)&&links.length<4)links.push(url.href);}catch{}
  };
  const clipboard=navigator.clipboard,original=clipboard?.writeText;
  const initialControls=new Set(document.querySelectorAll('input,textarea'));
  const wrapped=original?function(text:string){record(text);return original.call(clipboard,text);}:undefined;
  if(wrapped)try{clipboard.writeText=wrapped;}catch{}
  const onCopy=(event:ClipboardEvent)=>{
   const active=document.activeElement;
   if(active instanceof HTMLInputElement&&active.type==='password')return;
   let selection=active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement?active.value.slice(active.selectionStart??0,active.selectionEnd??0):getSelection()?.toString()||'';
   // Clipboard libraries select a temporary offscreen textarea without giving
   // it focus. Read only newly created selection sources from this action.
   if(!selection)for(const el of document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')){
    if(initialControls.has(el)||el instanceof HTMLInputElement&&el.type==='password')continue;
    const text=el.value.slice(el.selectionStart??0,el.selectionEnd??0);if(text){selection=text;break;}
   }
   // Legacy copy handlers may stop bubbling and clipboardData becomes protected
   // after dispatch. Observe their supplied text while forwarding setData intact.
   const data=event.clipboardData,originalSet=data?.setData;let supplied=false;
   const wrappedSet=originalSet?function(format:string,text:string){if(['text/plain','text'].includes(format.toLowerCase())){supplied=true;record(text);}return originalSet.call(data,format,text);}:undefined;
   if(data&&wrappedSet)try{data.setData=wrappedSet;}catch{}
   queueMicrotask(()=>{if(!supplied)record(data?.getData('text/plain')||(!event.defaultPrevented?selection:''));if(data&&originalSet&&data.setData===wrappedSet)try{data.setData=originalSet;}catch{}});
  };
  document.addEventListener('copy',onCopy,true);
  (window as unknown as Record<string,unknown>)[key]=()=>{
   document.removeEventListener('copy',onCopy,true);
   if(wrapped&&clipboard.writeText===wrapped)try{clipboard.writeText=original;}catch{}
   delete (window as unknown as Record<string,unknown>)[key];return links;
  };
 },key).catch(()=>{})));
 let finished:Promise<string[]>|undefined;
 return ()=>finished??=Promise.all(frames.map(frame=>frame.evaluate(key=>{
  const finish=(window as unknown as Record<string,unknown>)[key];return typeof finish==='function'?(finish as ()=>string[])():[];
 },key).catch(()=>[]))).then(results=>[...new Set(results.flat())]);
}
