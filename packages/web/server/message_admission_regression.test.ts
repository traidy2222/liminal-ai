import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from './routes.js';

function response() {
  return { statusCode:200, headersSent:false, body:undefined as any,
    status(code:number){this.statusCode=code;return this;},
    json(body:unknown){this.body=body;this.headersSent=true;return this;} };
}
function fixture(bridge:any) {
  const errors:unknown[]=[];
  const router=createRouter({getActive:()=>bridge} as any,{send:(...args:unknown[])=>errors.push(args)} as any,{} as any);
  const handle=(router as any).stack.find((entry:any)=>entry.route?.path==='/api/message').route.stack[0].handle;
  return {handle,errors};
}
test('message readiness rejection becomes an HTTP error and releases admission',async()=>{
  let fail=true,sends=0;
  const {handle}=fixture({chatId:'fixture',isBusy:false,harness:{getIsRunning:()=>false},
    whenSessionReady:async()=>{if(fail)throw Error('session failed');},sendUserMessage:async()=>{sends++;}});
  const first=response();
  await handle({body:{message:'hello'}},first);
  assert.equal(first.statusCode,500);assert.match(first.body.error,/session failed/);
  fail=false;const second=response();await handle({body:{message:'hello'}},second);
  assert.equal(second.statusCode,200);assert.equal(sends,1);
});
test('message admission reserves the chat before readiness awaits and until send settles',async()=>{
  let ready!:()=>void,done!:()=>void,sends=0;
  const readiness=new Promise<void>(r=>{ready=r;});const turn=new Promise<void>(r=>{done=r;});
  const {handle}=fixture({chatId:'fixture',isBusy:false,harness:{getIsRunning:()=>false},
    whenSessionReady:()=>readiness,sendUserMessage:async(_message:string,options:{onStart:()=>void})=>{
      sends++;options.onStart();await turn;
    }});
  const first=response(),second=response();const a=handle({body:{message:'first'}},first),b=handle({body:{message:'second'}},second);
  try {
    assert.equal(second.statusCode,409,'second request is rejected before session readiness');
    ready();await a;await b;
    assert.equal(first.statusCode,200);assert.deepEqual(first.body,{ok:true});
    const third=response();await handle({body:{message:'third'}},third);
    assert.equal(third.statusCode,409);assert.equal(sends,1);
  } finally {ready();done();await Promise.allSettled([a,b]);}
});
test('malformed attachments produce a client error',async()=>{
  const {handle}=fixture({isBusy:false,harness:{getIsRunning:()=>false},whenSessionReady:async()=>{}});
  const res=response();await handle({body:{message:'hello',attachments:{}}},res);assert.equal(res.statusCode,400);
});
