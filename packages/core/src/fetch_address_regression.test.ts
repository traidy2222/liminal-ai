import test from 'node:test';
import assert from 'node:assert/strict';
import { guardToolArgs } from './tool_arg_guard.js';
for(const host of ['[::1]','127.0.0.2','0.0.0.0','169.254.169.254','10.0.0.5','172.16.0.1','192.168.1.2','[::ffff:127.0.0.1]','[fc00::1]','[fe80::1]'])test(`web_fetch blocks internal literal ${host}`,()=>assert.ok(guardToolArgs('web_fetch',{url:`http://${host}/`})));
test('public hosts remain allowed',()=>{for(const host of ['example.com','8.8.8.8','[2606:4700:4700::1111]'])assert.equal(guardToolArgs('web_fetch',{url:`https://${host}/`}),null);});
