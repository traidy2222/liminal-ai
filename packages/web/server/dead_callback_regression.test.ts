import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalWebAuth } from './local_auth.js';
import { createRouter } from './routes.js';
test('unused legacy Google callback has no route or anonymous auth exemption',async()=>{
  const old=process.env.AGENT_WEB_TOKEN;process.env.AGENT_WEB_TOKEN='synthetic-callback-test';
  try {
    const auth=await createLocalWebAuth();let status=0,next=false;
    auth.requireAuth({method:'GET',path:'/oauth/google/callback',socket:{remoteAddress:'127.0.0.1'},headers:{},query:{},header:()=>undefined} as any,
      {status(code:number){status=code;return this;},json(){}} as any,()=>{next=true;});
    assert.equal(next,false);assert.equal(status,401);
    const router=createRouter({} as any,{} as any,auth);
    assert.equal((router as any).stack.some((r:any)=>r.route?.path==='/oauth/google/callback'),false);
    assert.equal((router as any).stack.some((r:any)=>r.route?.path==='/api/integrations/oauth/handoff'),true);
  } finally {if(old===undefined)delete process.env.AGENT_WEB_TOKEN;else process.env.AGENT_WEB_TOKEN=old;}
});
