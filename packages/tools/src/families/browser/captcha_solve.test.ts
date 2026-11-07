import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, type AgentHarness } from "@liminal/core";
import { captchaSolveTool, poll2Captcha } from "./captcha_solve.js";
import { browserTabsTool } from "./browser_tools.js";

test("2Captcha polls securely, waits for processing, and stops on a terminal error", async () => {
  const original = globalThis.fetch;
  const key = "synthetic-captcha-key";
  let requests = 0;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "2captcha.com");
      assert.equal(url.searchParams.get("key"), key);
      requests++;
      return new Response(JSON.stringify(requests === 1 ? {status:0,request:"CAPCHA_NOT_READY"} : {status:1,request:"fixture-token"}));
    };
    assert.equal(await poll2Captcha(key,"fixture-task",1000,1),"fixture-token");
    assert.equal(requests,2);
    requests=0;
    globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({status:0,request:"ERROR_KEY_DOES_NOT_EXIST " + key}));};
    await assert.rejects(poll2Captcha(key,"fixture-task",1000,1),error=>{
      assert.ok(error instanceof Error);
      assert.match(error.message,/ERROR_KEY_DOES_NOT_EXIST/);
      assert.ok(!error.message.includes(key));
      return true;
    });
    assert.equal(requests,1,"terminal errors must not poll until the timeout");
  } finally {globalThis.fetch=original;}
});

test("browser agents discover the configured solver without exposing its key", async () => {
  const previous=process.env.AGENT_CAPTCHA_KEY;
  try {
    process.env.AGENT_CAPTCHA_KEY="synthetic-captcha-key";
    const registry=new ToolRegistry();registry.register(captchaSolveTool);registry.setLazyToolLoading(true);
    const result=await browserTabsTool.handler({},undefined,{taskId:"captcha-discovery-fixture",registry} as AgentHarness);
    assert.ok(result.ok);
    assert.ok(registry.isActive("captcha_solve"));
    assert.ok(!JSON.stringify(result).includes(process.env.AGENT_CAPTCHA_KEY));
    delete process.env.AGENT_CAPTCHA_KEY;
    registry.seedActiveTools([]);
    await browserTabsTool.handler({},undefined,{taskId:"captcha-discovery-fixture",registry} as AgentHarness);
    assert.equal(registry.isActive("captcha_solve"),false);
  } finally {if(previous===undefined)delete process.env.AGENT_CAPTCHA_KEY;else process.env.AGENT_CAPTCHA_KEY=previous;}
});

test("submission uses HTTPS and reports service errors without leaking the key", async () => {
  const previous=process.env.AGENT_CAPTCHA_KEY,original=globalThis.fetch;
  try {
    process.env.AGENT_CAPTCHA_KEY="synthetic-captcha-key";
    let requests=0;
    globalThis.fetch=async(input,init)=>{
      requests++;
      assert.equal(String(input),"https://2captcha.com/in.php");
      assert.equal(init?.method,"POST");
      return new Response(JSON.stringify({status:0,request:"ERROR_ZERO_BALANCE synthetic-captcha-key"}));
    };
    const result=await captchaSolveTool.handler({service:"2captcha",type:"image",page_url:"https://example.com",image_base64:"fixture"});
    assert.equal(result.ok,false);assert.match(JSON.stringify(result),/ERROR_ZERO_BALANCE/);
    assert.ok(!JSON.stringify(result).includes("synthetic-captcha-key"));
    assert.equal(requests,1);
  } finally {globalThis.fetch=original;if(previous===undefined)delete process.env.AGENT_CAPTCHA_KEY;else process.env.AGENT_CAPTCHA_KEY=previous;}
});
