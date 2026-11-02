import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent} from 'undici';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {Socket} from 'node:net';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
import {publicWebFetch} from '../../shared/public_web_fetch.js';
test('public transport receives a real HTTP response through its npm dispatcher',async(t)=>{
 const server=createServer((_req,res)=>res.end('compatible response'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 // Route sockets to a local fixture while preserving the actual HTTP parser and dispatcher protocol.
 const fixture=new Agent({connect:(_options,callback)=>{
  const socket=connect({host:'127.0.0.1',port:(server.address() as any).port},()=>callback(null,socket));socket.on('error',error=>callback(error,null));
 }});
 const dispatch=Agent.prototype.dispatch;
 t.mock.method(Agent.prototype,'dispatch',function(options:any,handler:any){return dispatch.call(fixture,options,handler);});
 try{const response=await publicWebFetch('http://public.fixture/');assert.equal(response.status,200);assert.equal(await response.text(),'compatible response');}
 finally{t.mock.restoreAll();await fixture.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('production publicLookup validates DNS before connecting and receives a real response', async (t) => {
 const server = createServer((_req, res) => res.end('validated lookup response'));
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const publicAddress = '93.184.216.34';
 const originalLookup = dns.lookup;
 const originalConnect = Socket.prototype.connect;
 let dnsCalls = 0;
 let validatedConnections = 0;
 t.mock.method(dns, 'lookup', ((hostname: string, options: any, callback: any) => {
  if (hostname !== 'lookup.fixture') return (originalLookup as any)(hostname, options, callback);
  dnsCalls++;
  assert.deepEqual(options, { all: true, verbatim: true });
  callback(null, [{ address: publicAddress, family: 4 }]);
 }) as typeof dns.lookup);
 syncBuiltinESMExports();
 t.mock.method(Socket.prototype, 'connect', function(this: Socket, ...args: any[]) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (options?.host !== 'lookup.fixture') return (originalConnect as any).apply(this, args);
  const productionLookup = options.lookup;
  assert.equal(typeof productionLookup, 'function');
  return originalConnect.call(this, {
   ...options, port: (server.address() as any).port, autoSelectFamily: false,
   lookup(hostname: string, lookupOptions: any, callback: any) {
    productionLookup(hostname, lookupOptions, (error: Error | null, address: string, family: number) => {
     if (error) { callback(error); return; }
     assert.equal(address, publicAddress);
     assert.equal(family, 4);
     validatedConnections++;
     // Substitute only the already-validated destination with the local fixture.
     callback(null, '127.0.0.1', 4);
    });
   },
  });
 });
 try {
  const response = await publicWebFetch('http://lookup.fixture/', { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'validated lookup response');
  assert.equal(dnsCalls, 1);
  assert.equal(validatedConnections, 1);
 } finally {
  t.mock.restoreAll();
  syncBuiltinESMExports();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
 }
});
