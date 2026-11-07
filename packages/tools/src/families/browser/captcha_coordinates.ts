import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Page} from 'playwright';
import {browserScreenshotPrivacyStyle} from './browser_screenshot_privacy.js';
export type CaptchaRegion={x:number;y:number;width:number;height:number};
export async function captureCaptchaRegion(page:Page,raw:unknown){
 const r=raw as CaptchaRegion;
 if(!r||![r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))||r.x<0||r.y<0||r.width<10||r.height<10||r.width>1000||r.height>1000)throw Error('coordinates requires region {x,y,width,height} in viewport CSS pixels; dimensions 10–1000. No paid task submitted.');
 const view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 if(r.x+r.width>view.width||r.y+r.height>view.height)throw Error('CAPTCHA region is outside the current viewport. No paid task submitted.');
 const bytes=await page.screenshot({type:'jpeg',quality:85,scale:'css',clip:{...r},style:browserScreenshotPrivacyStyle,timeout:5000});
 if(bytes.length>600000)throw Error('CAPTCHA image exceeds the provider limit. Choose a smaller region. No paid task submitted.');
 return {region:{x:r.x,y:r.y,width:r.width,height:r.height},url:page.url(),hash:createHash('sha256').update(bytes).digest('hex'),body:bytes.toString('base64')};
}
export async function solveCoordinateImage(input:{key:string;body:string;instructionImage?:string;instructions:string;minClicks:number;maxClicks:number;timeoutMs:number;pollMs?:number;signal?:AbortSignal}){
 const {key,signal}=input,deadline=Date.now()+input.timeoutMs;
 if(!input.instructions.trim()||input.instructions.length>500||!Number.isInteger(input.minClicks)||!Number.isInteger(input.maxClicks)||input.minClicks<1||input.maxClicks>10||input.maxClicks<input.minClicks)throw Error('Coordinates task requires instructions and 1–10 ordered points. No paid task submitted.');
 const request=async(method:string,payload:Record<string,unknown>)=>{
  signal?.throwIfAborted();const remaining=deadline-Date.now();if(remaining<=0)throw Error('Coordinate solver timed out');
  const timeout=AbortSignal.timeout(Math.min(15000,remaining));
  const response=await fetch('https://api.2captcha.com/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientKey:key,...payload}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if(!response.ok)throw Error('Coordinate solver HTTP '+response.status);
  const data=await response.json() as {errorId?:number;errorCode?:string;errorDescription?:string;taskId?:number;status?:string;solution?:{coordinates?:unknown};cost?:string};
  if(data.errorId)throw Error(('2Captcha: '+(data.errorCode||'task failed')+' '+(data.errorDescription||'')).replaceAll(key,'[REDACTED]'));
  return data;
 };
 const submitted=await request('createTask',{task:{type:'CoordinatesTask',body:input.body,...(input.instructionImage?{imgInstructions:input.instructionImage}:{}),comment:input.instructions,minClicks:input.minClicks,maxClicks:input.maxClicks}});
 if(!Number.isInteger(submitted.taskId)||!submitted.taskId)throw Error('2Captcha did not return a valid task id');
 while(Date.now()<deadline){
  await delay(Math.min(input.pollMs??5000,Math.max(1,deadline-Date.now())),undefined,{signal});
  const result=await request('getTaskResult',{taskId:submitted.taskId});
  if(result.status==='processing')continue;
  if(result.status!=='ready'||!Array.isArray(result.solution?.coordinates))throw Error('2Captcha returned an invalid coordinate result');
  const points=result.solution.coordinates as {x:number;y:number}[];
  if(points.length<input.minClicks||points.length>input.maxClicks||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0))throw Error('2Captcha returned invalid point coordinates');
  return {points:points.map(p=>({x:p.x,y:p.y})),cost:result.cost};
 }
 throw Error('Coordinate solver timed out');
}
