import test from 'node:test';
import assert from 'node:assert/strict';
import {guardToolArgs} from './tool_arg_guard.js';
test('web URL guard rejects trailing-dot localhost aliases and bracketed internal IPv6',()=>{
 for(const url of ['http://localhost.','http://foo.localhost.','http://[::1]/','http://[::ffff:127.0.0.1]/']) assert.match(guardToolArgs('web_fetch',{url})??'',/Blocked/,url);
 assert.equal(guardToolArgs('web_fetch',{url:'https://example.com.'}),null);
});
