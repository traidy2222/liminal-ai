import type {Page} from 'playwright';
import {setTimeout as delay} from 'node:timers/promises';
import {captureCaptchaRegion,solveCoordinateImage,type CaptchaRegion} from './captcha_coordinates.js';
import {dragBrowserPointer} from './browser_drag.js';

/** One explicit source crop, one worker destination, one backend-owned gesture.
 * Both crops are relative to an observed visual element, never an LLM viewport guess. */
export async function solveVisualDrag(input:{page:Page;box:CaptchaRegion;source:unknown;key:string;timeoutMs:number;pollMs?:number;signal?:AbortSignal;autoApply?:boolean}){
 const s=input.source as CaptchaRegion,b=input.box;
 if(!s||![s.x,s.y,s.width,s.height].every(n=>typeof n==='number'&&Number.isFinite(n))||s.x<0||s.y<0||s.width<10||s.height<10||s.width>250||s.height>250||s.x+s.width>b.width||s.y+s.height>b.height)throw Error('source_region must bound the loose piece inside the inspected canvas image. No paid task submitted.');
 let board=await captureCaptchaRegion(input.page,b),stable=false;
 for(let i=0;i<3;i++){await delay(120,undefined,{signal:input.signal});const next=await captureCaptchaRegion(input.page,b);if(next.hash===board.hash){board=next;stable=true;break;}board=next;}
 if(!stable)throw Error('Visual challenge is still changing. Wait for it to finish painting before a paid solve.');
 const piece=await captureCaptchaRegion(input.page,{x:b.x+s.x,y:b.y+s.y,width:s.width,height:s.height});
 if(Buffer.byteLength(piece.body,'base64')>100000)throw Error('Source instruction image exceeds provider limit. Use a tighter source region. No paid task submitted.');
 const solved=await solveCoordinateImage({key:input.key,body:board.body,instructionImage:piece.body,
  instructions:'Click ONCE at the CENTER of the empty cut-out whose outline matches the loose piece shown in the separate instruction image. Do NOT click the loose piece itself. Do NOT drag. Mark the matching destination hole only.',
  minClicks:1,maxClicks:1,timeoutMs:input.timeoutMs,pollMs:input.pollMs,signal:input.signal});
 const point=solved.points[0]!;
 if(point.x>=b.width||point.y>=b.height)throw Error('Solver destination is outside the captured canvas. No drag applied.');
 if(point.x>=s.x&&point.x<=s.x+s.width&&point.y>=s.y&&point.y<=s.y+s.height)throw Error('INVALID_VISUAL_SOLUTION: solver marked the loose source piece, not a destination hole. No drag applied.');
 const current=await captureCaptchaRegion(input.page,b);
 if(current.url!==board.url||current.hash!==board.hash)throw Error('VISUAL_CHALLENGE_CHANGED: canvas changed during solving. No drag applied.');
 const action={op:'drag_at' as const,from_x:b.x+s.x+s.width/2,from_y:b.y+s.y+s.height/2,to_x:b.x+point.x,to_y:b.y+point.y,duration_ms:900};
 if(input.autoApply!==false){await dragBrowserPointer(input.page,action,input.signal);await delay(300,undefined,{signal:input.signal});}
 return {action,applied:input.autoApply!==false,cost:solved.cost,
  verification_state:input.autoApply!==false?'pending_submission' as const:'not_applied' as const};
}
