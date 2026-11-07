import {setTimeout as delay} from 'node:timers/promises';
import type {Locator} from 'playwright';

/** A real pointer hold, including embedded frames; never leave the mouse pressed on cancellation. */
export async function holdBrowserControl(locator:Locator,durationMs:number,timeoutMs=15000,signal?:AbortSignal):Promise<void>{
 if(!Number.isInteger(durationMs)||durationMs<100||durationMs>15000)throw Error('press_and_hold_ref: duration_ms must be an integer from 100 to 15000');
 signal?.throwIfAborted();
 if(!await locator.isEnabled({timeout:timeoutMs}))throw Error('TARGET_DISABLED: no hold executed. Wait for the observed control to become enabled.');
 await locator.hover({timeout:timeoutMs});
 signal?.throwIfAborted();
 const mouse=locator.page().mouse;
 try{
  await mouse.down({button:'left'});
  await delay(durationMs,undefined,{signal});
 }finally{
  await mouse.up({button:'left'}).catch(()=>{});
 }
}
