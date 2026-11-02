import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

// Patch the CJS dependency before the first ESM import; no native terminal is started.
const native=createRequire(import.meta.url)('node-pty');
const original=native.spawn;
const spawned:any[]=[];
native.spawn=(_shell:unknown,_args:unknown,options:unknown)=>{
  const proc={options,data:(_data:string)=>{},exit:(_event:{exitCode:number})=>{},
    onData(cb:any){this.data=cb;return {dispose(){}};},onExit(cb:any){this.exit=cb;return {dispose(){}};},
    kill(){},resize(){},write(){}};
  spawned.push(proc);return proc;
};
const {PtyManager}=await import('./pty_manager.js');
after(()=>{native.spawn=original;});
function socket(){
  return Object.assign(new EventEmitter(),{OPEN:1,readyState:1,sent:[] as string[],closed:false,
    send(data:string){this.sent.push(data);},close(){this.closed=true;this.emit('close');}});
}
test('interactive and one-shot terminals do not inherit credential environment variables',async()=>{
  const env={...process.env};const manager=new PtyManager();
  process.env.AGENT_API_KEY='synthetic-key';process.env.GITHUB_TOKEN='synthetic-token';
  process.env.AWS_SECRET_ACCESS_KEY='synthetic-secret';process.env.DATABASE_PASSWORD='synthetic-password';
  process.env.LIMINAL_FIXTURE_SAFE='keep-me';
  try {
    const info=manager.open({chatId:'fixture',workspaceRoot:process.cwd()});
    const interactive=spawned.at(-1);interactive.exit({exitCode:0});
    const result=manager.runOneshot({chatId:'fixture',workspaceRoot:process.cwd(),command:'echo fixture',timeoutMs:1000});
    const oneshot=spawned.at(-1);oneshot.exit({exitCode:0});await result;
    for(const proc of [interactive,oneshot]){
      for(const name of ['AGENT_API_KEY','GITHUB_TOKEN','AWS_SECRET_ACCESS_KEY','DATABASE_PASSWORD']) assert.equal(proc.options.env[name],undefined,name);
      assert.equal(proc.options.env.LIMINAL_FIXTURE_SAFE,'keep-me');assert.equal(proc.options.env.LIMINAL_CHAT_ID,info.chatId);
    }
  } finally {manager.disposeAll();process.env=env;}
});
test('one-shot output reaches observers and sockets, and exit releases attached resources',async()=>{
  const manager=new PtyManager(),ws=socket(),events:string[]=[],listeners:string[]=[],direct:string[]=[];
  let id='';manager.on('data',(_id,_chat,data)=>events.push(data));
  const result=manager.runOneshot({chatId:'fixture',workspaceRoot:process.cwd(),command:'echo fixture',timeoutMs:1000,
    onData:data=>direct.push(data),onSessionStart:info=>{id=info.sessionId;manager.attachSocket(id,ws as any);manager.onSessionData(id,data=>listeners.push(data));}});
  const proc=spawned.at(-1),record=(manager as any).sessions.get(id);
  proc.data('hello');proc.exit({exitCode:0});
  assert.equal((await result).output,'hello');assert.deepEqual(direct,['hello']);
  assert.deepEqual(events,['hello']);assert.deepEqual(listeners,['hello']);assert.deepEqual(ws.sent,['hello']);
  assert.equal(ws.closed,true);assert.equal(record.dataListeners.size,0);assert.equal(record.sockets.size,0);assert.equal(manager.isAlive(id),false);
});
test('one-shot timeout cleans up even when the PTY never emits exit',async()=>{
  const manager=new PtyManager(),ws=socket();let id='';
  const result=manager.runOneshot({chatId:'fixture',workspaceRoot:process.cwd(),command:'echo fixture',timeoutMs:10,
    onSessionStart:info=>{id=info.sessionId;manager.attachSocket(id,ws as any);}});
  await assert.rejects(result,/timed out/);
  assert.equal(manager.isAlive(id),false);assert.equal(ws.closed,true);
});
