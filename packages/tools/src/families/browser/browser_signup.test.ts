import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { ToolDispatcher, ToolRegistry, AgentEmitter } from "@liminal/core";
import { BROWSER_ACTION_SCHEMA } from "./browser_tools.js";
import { openBrowserSession, getBrowserSession, snapshotBrowserSession, actOnBrowserSession,
  browserCredentialAction, shutdownBrowserWorkspace } from "../../../dist/families/browser/browser_runtime.js";
import { prepareBrowserLogin, readBrowserLoginForFill } from "../../../dist/families/browser/browser_credentials.js";

test("browser action schema catches missing fields and invalid variants before execution", async () => {
  const registry = new ToolRegistry(); let calls = 0;
  registry.register({name:"action_fixture",description:"fixture",requiresApproval:false,
    parameters:{type:"object",properties:{actions:{type:"array",items:BROWSER_ACTION_SCHEMA}},required:["actions"]},
    handler:async()=>{calls++;return {ok:true,output:"done"};}});
  const dispatcher = new ToolDispatcher(registry,new AgentEmitter());
  for (const action of [{value:100},{op:"wait_ms",value:100},{op:"fill_ref",ref:"e1"},{op:"oops"}]) {
    assert.equal((await dispatcher.dispatch("bad","action_fixture",JSON.stringify({actions:[action]}))).ok,false);
  }
  assert.equal(calls,0);
  assert.ok((await dispatcher.dispatch("good","action_fixture",JSON.stringify({actions:[{op:"wait_ms",ms:10},{op:"select_option_ref",ref:"e1",value:"July"}]}))).ok);
  assert.equal(calls,1);
});

test("signup controls use exact observed nodes, custom options and encrypted reusable autofill", {skip:process.env.AGENT_BROWSER_INTEGRATION!=="1"}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"liminal-signup-"));
  const oldBrowser=process.env.LIMINAL_BROWSER_DATA_DIR, oldGlobal=process.env.AGENT_GLOBAL_STORAGE_ROOT;
  process.env.LIMINAL_BROWSER_DATA_DIR=root; process.env.AGENT_GLOBAL_STORAGE_ROOT=path.join(root,"global");
  const server=createServer((_req,res)=>{res.setHeader("Content-Type","text/html");res.end(`
    <div style="display:none"><button>Loading</button></div><form>
    <span id="month-label">Month</span><div role="combobox" aria-labelledby="month-label" tabindex="0" onclick="document.querySelector('[role=listbox]').hidden=false">Choose</div>
    <div role="listbox" hidden><div role="option" data-value="7" onclick="document.querySelector('[role=combobox]').dataset.selected='7';this.parentElement.hidden=true">July</div></div>
    <label>Gender<select id="gender" aria-label="Gender"><option value="m">Male</option><option value="f">Female</option></select></label>
    <label>Username<input id="user"></label><label>Password<input id="pass" type="password"></label><label>Confirm<input id="confirm" type="password"></label></form>`);});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r)); const addr=server.address();assert.ok(addr&&typeof addr!=="string");
  const url=`http://127.0.0.1:${addr.port}/`;
  try {
    const opened=await openBrowserSession({ownerTaskId:"signup-test",href:url,waitUntil:"load",navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});
    assert.ok(opened.ok,opened.ok?"":opened.error); const id=opened.sessionId,page=getBrowserSession(id)!.page;
    let snapshot=opened.output;
    const ref=(name:string)=>{const found=snapshot.split("\n").find(line=>/^\s+e\d+ /.test(line)&&line.includes(`"${name}"`));assert.ok(found,`missing ${name}`);return found.trim().split(" ")[0]!;};
    const month=ref("Month");assert.ok(!snapshot.includes("data-liminal-ref"),"internal markers must not be confused with public refs");
    const acted=await actOnBrowserSession({sessionId:id,actions:[{op:"select_option_ref",ref:month,value:"July"},{op:"select_option_ref",ref:ref("Gender"),value:"Female"}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
    assert.ok(acted.ok,acted.ok?"":acted.error);snapshot=acted.output;assert.equal(await page.locator('[role=combobox]').getAttribute('data-selected'),"7");assert.equal(await page.locator('#gender').inputValue(),"f");
    const login=prepareBrowserLogin(url,"fixture-user"); assert.equal(prepareBrowserLogin(url,"fixture-user").id,login.id);
    const secret=readBrowserLoginForFill(url,login.id).password;
    const stored=await fs.readFile(path.join(root,"credentials",login.id+".json"),"utf8"); assert.ok(!stored.includes(secret));assert.ok(!JSON.stringify(login).includes(secret));
    assert.throws(()=>readBrowserLoginForFill("https://different.example/",login.id),/different origin/);
    const filled=await browserCredentialAction({action:"fill",session_id:id,credential_id:login.id,username_ref:ref("Username"),password_ref:ref("Password"),confirm_password_ref:ref("Confirm")});
    assert.ok(filled.ok);assert.equal(await page.locator('#pass').inputValue(),secret);assert.equal(await page.locator('#confirm').inputValue(),secret);assert.ok(!JSON.stringify(filled).includes(secret));
    const snap=await snapshotBrowserSession(id,false);assert.ok(snap.ok,snap.ok?"":snap.error);snapshot=snap.output;assert.ok(!JSON.stringify(snap).includes(secret),JSON.stringify(snap).replaceAll(secret,"[SECRET]"));
    const stale=ref("Username"); await page.locator('#user').evaluate(el=>el.outerHTML='<input id="user" aria-label="Replacement">');
    const rejected=await actOnBrowserSession({sessionId:id,actions:[{op:"fill_ref",ref:stale,value:"must-not-reach-replacement",timeout_ms:500}],postActionWaitMs:0,refreshSnapshot:false,includeConsole:false});
    assert.equal(rejected.ok,false);assert.equal(await page.locator('#user').inputValue(),"");
  } finally {
    await shutdownBrowserWorkspace(); server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
    if(oldBrowser===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=oldBrowser;
    if(oldGlobal===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=oldGlobal;
    await fs.rm(root,{recursive:true,force:true});
  }
});
