import test from 'node:test';
import assert from 'node:assert/strict';
import {clientFrame,type ClientFrame,type ServerFrame} from '@liminal/protocol';
import {WsServer} from './ws_server.js';

test('owner can display an activated chat without a click; quiet or invalid activation does not navigate',async()=>{
 const frames:ServerFrame[]=[];const acks:boolean[]=[];
 const server=Object.assign(Object.create(WsServer.prototype),{
  clientRole:()=> 'owner',registry:{activate:async(id:string)=>id==='known'},
  broadcastChatList:()=>{},broadcast:(frame:ServerFrame)=>frames.push(frame),
  ack:(_ws:unknown,_id:string,ok:boolean)=>acks.push(ok),
 }) as {dispatch(ws:unknown,frame:ClientFrame):Promise<void>};
 await server.dispatch({},clientFrame('quiet','activate_chat',{chatId:'known'}));
 assert.equal(frames.length,0);
 await server.dispatch({},clientFrame('show','activate_chat',{chatId:'known',show:true}));
 assert.deepEqual(frames.map(f=>({event:f.event,data:f.data})),[{event:'chat_focus_requested',data:{chatId:'known'}}]);
 await server.dispatch({},clientFrame('missing','activate_chat',{chatId:'missing',show:true}));
 assert.equal(frames.length,1);assert.deepEqual(acks,[true,true,false]);
});
