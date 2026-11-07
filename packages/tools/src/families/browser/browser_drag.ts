import type {Page} from 'playwright';
import {setTimeout as delay} from 'node:timers/promises';
export type BrowserDrag={from_x:number;from_y:number;to_x:number;to_y:number;duration_ms?:number};
/** Ordinary trusted pointer input; release on cancellation, navigation or error. */
export async function dragBrowserPointer(page:Page,op:BrowserDrag,signal?:AbortSignal):Promise<void>{
 const duration=op.duration_ms??900;
 if(!Number.isInteger(duration)||duration<100||duration>5000)throw Error('drag_at: duration_ms must be an integer from 100 to 5000');
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 const points:[number,number][]=[[op.from_x,op.from_y],[op.to_x,op.to_y]];
 for(const [x,y] of points)if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=viewport.width||y>=viewport.height)throw Error('drag_at: start and end must be inside the current CSS viewport; no drag executed.');
 signal?.throwIfAborted();await page.mouse.move(op.from_x,op.from_y);
 try{
  await page.mouse.down({button:'left'});
  const steps=Math.max(8,Math.min(40,Math.ceil(duration/25)));
  for(let i=1;i<=steps;i++){
   signal?.throwIfAborted();await page.mouse.move(op.from_x+(op.to_x-op.from_x)*i/steps,op.from_y+(op.to_y-op.from_y)*i/steps);
   await delay(duration/steps,undefined,{signal});
  }
 }finally{await page.mouse.up({button:'left'}).catch(()=>{});}
}
