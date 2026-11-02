import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEFAULT_PERSONA_UI_THEME } from '../packages/core/dist/persona_ui_theme.js';
import { buildHarnessSettingsApiFields } from '../packages/core/dist/harness_settings_api.js';
import { HARNESS_SETTINGS_TABS } from '../packages/core/dist/harness_settings_field_meta.js';
import { fetchOpenRouterSettingsCatalog } from '../packages/core/dist/openrouter_catalog.js';
const out = path.resolve('assets/marketing/update-2026-11-02');
const base = process.env.MARKETING_UPDATE_URL || 'http://localhost:5173';
await fs.mkdir(out, {recursive:true});
const models = await fetchOpenRouterSettingsCatalog();
const selected = models.find(m=>m.id==='deepseek/deepseek-v4-pro') || models.find(m=>m.supportsTools && m.inputModalities.includes('image') && !m.isRouter);
const fields = buildHarnessSettingsApiFields(null).map(f=>({...f,lockedByEnv:false,value:({AGENT_SINGLE_MODEL:'1',AGENT_MODEL:selected.id,AGENT_INFERENCE_MODE:'byok',AGENT_SESSION_GREET:'0'})[f.key] ?? f.value}));
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1.5});
const failures=[]; page.on('pageerror',e=>failures.push(e.message));
await page.addInitScript(()=>{
 class DemoEventSource extends EventTarget {
  static CONNECTING=0; static OPEN=1; static CLOSED=2; readyState=1;
  constructor(){super();setTimeout(()=>this.dispatchEvent(new MessageEvent('connected',{data:JSON.stringify({cursor:0})})),100);}
  close(){this.readyState=2;}
 }
 window.EventSource=DemoEventSource;
});
await page.route('**/api/**', async route=>{
 const u=new URL(route.request().url()); let body={};
 if(u.pathname==='/api/config')body={webAuthToken:'marketing-demo',personaUiTheme:DEFAULT_PERSONA_UI_THEME,personaDisplayLabel:'Liminal',activeChat:{chatId:'demo'},personaBootstrapPending:false,sessionGreetEnabled:false};
 if(u.pathname==='/api/status')body={running:false,busy:false};
 if(u.pathname==='/api/chats')body={chats:[{chatId:'demo',title:'A fresh start',workspaceMode:'folder',workspaceRoot:'C:/Projects/Studio',updatedAt:Date.now(),createdAt:Date.now()}],activeChatId:'demo',residentChatIds:['demo'],orphanIds:[]};
 if(u.pathname==='/api/settings')body={fields,tabs:HARNESS_SETTINGS_TABS,provider:{model:selected.id,baseURL:'https://openrouter.ai/api/v1',apiKeyConfigured:true,inferenceMode:'byok'}};
 if(u.pathname==='/api/models/openrouter')body={models};
 if(u.pathname==='/api/integrations')body={google:{accounts:[],services:[]},connections:[],providerStatus:{},serviceCards:{}};
 return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
const captures=[];
async function shot(id,title,source='Current web UI; isolated demo workspace'){
 await page.evaluate(()=>document.fonts.ready); await page.mouse.move(1590,1090); await page.screenshot({path:path.join(out,id+'.png')});
 captures.push({id,title,source});
}
await page.goto(base); await page.getByRole('heading',{name:'What are we working on?'}).waitFor(); await page.waitForTimeout(500);
await shot('01-web-workspace','A little space. A lot of possibility.');
await page.getByRole('button',{name:'Settings',exact:true}).first().click(); await page.getByRole('dialog',{name:'Settings'}).waitFor();
const search=page.getByRole('searchbox',{name:'Search OpenRouter models'}); await search.waitFor(); await page.locator('.model-results button').first().waitFor();
await shot('02-openrouter-catalog','Your model. Your choice.');
await search.fill('deepseek'); await shot('03-model-search','Find your model in seconds.');
await search.fill(selected.id); await page.locator('.model-single-toggle').scrollIntoViewIfNeeded(); await shot('04-single-model','One model. Every step.');
await page.getByRole('button',{name:'Preferences',exact:true}).click(); await shot('05-preferences','Less setup. More doing.');
await page.getByRole('button',{name:'Connected tools',exact:true}).click(); await page.getByText('Google Workspace',{exact:true}).waitFor(); await shot('06-connected-tools','Bring your tools together.');
await page.setViewportSize({width:430,height:932}); await page.goto(base); await page.getByRole('heading',{name:'What are we working on?'}).waitFor(); await page.waitForTimeout(300); await shot('07-mobile-workspace','Your workspace, on a smaller screen.');
await page.setViewportSize({width:1600,height:1100});
// Compose promotional frames from unchanged screenshots. These are designed cards, not product UI.
const data=async name=>'data:image/png;base64,'+(await fs.readFile(path.join(out,name+'.png'))).toString('base64');
const card=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:2});
async function promo(id,kicker,title,subtitle,sourceId){
 await card.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;background:#10121b;color:#eeedf5;font-family:Arial,sans-serif}.wrap{height:630px;padding:48px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 80% 70%,#302b4c,transparent 65%)}.brand{font-size:23px;letter-spacing:-1px}.mark{display:inline-block;border:2px solid #b6a1ef;width:18px;height:22px;vertical-align:middle;margin-right:12px;box-shadow:5px -5px 0 -2px #10121b,5px -5px 0 0 #716384}.kicker{margin-top:72px;color:#bca8f3;font-size:12px;letter-spacing:2px;text-transform:uppercase}h1{font-size:49px;font-weight:500;letter-spacing:-2px;line-height:1.05;max-width:390px;margin:19px 0}p{font-size:17px;color:#aeb0bf;line-height:1.5;max-width:350px}.image{position:absolute;left:490px;top:100px;width:860px;border:1px solid #444052;border-radius:14px;box-shadow:0 35px 80px #0008}footer{position:absolute;bottom:34px;font-size:13px;color:#c9bcf0}.tag{position:absolute;bottom:34px;right:35px;font-size:11px;color:#aaa4b9}</style><div class="wrap"><div class="brand"><span class="mark"></span>Liminal /</div><div class="kicker">${kicker}</div><h1>${title}</h1><p>${subtitle}</p><img class="image" src="${await data(sourceId)}"><footer>vireondynamics.com/liminal →</footer><div class="tag">Current UI · demo workspace</div></div></html>`);
 await card.screenshot({path:path.join(out,id+'.png')});captures.push({id,title,source:'Designed social card with current web UI in demo workspace',dimensions:'2400×1260'});
}
await promo('08-social-workspace','Your working space','Room for your<br>next idea.','A self-hosted AI workspace for building, exploring, and getting things done.','01-web-workspace');
await promo('09-social-model-choice','OpenRouter model search','Your model.<br>Your choice.','Search the full catalog. See capabilities. Choose the model that fits.','03-model-search');
await promo('10-social-single-model','Simpler model setup','One model.<br>Every step.','Keep chat and background work on the model you choose.','04-single-model');
// A real native capture, cropped to the hub's welcome section. Account footer and chat history excluded.
try {
 const native=await fs.readFile('.agent_artifacts/marketing-private/native-hub.png');
 await card.setViewportSize({width:1500,height:430});
 await card.setContent(`<body style="margin:0;overflow:hidden;background:#11141c"><img style="position:absolute;width:2560px;height:1393px;left:-680px;top:-125px" src="data:image/png;base64,${native.toString('base64')}"></body>`);
 await card.screenshot({path:path.join(out,'11-native-hub-crop.png')});captures.push({id:'11-native-hub-crop',title:'Native Windows hub',source:'Actual current Release Windows app, welcome area crop; account details and chat history excluded'});
} catch(e) { console.log('Native source unavailable: '+e.message); }
// Contact sheet: compact review of every deliverable.
await card.setViewportSize({width:1600,height:Math.ceil(captures.length/3)*370+100});
await card.setContent(`<style>body{margin:0;padding:30px;background:#11131c;color:#f0edf7;font:15px Arial}h1{font-size:28px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}figure{margin:0}img{width:100%;height:290px;object-fit:contain;background:#191c28;border:1px solid #373343;border-radius:8px}figcaption{margin-top:10px;color:#c4b9df}</style><h1>Liminal / Update image pack · November 2026</h1><main>${(await Promise.all(captures.map(async c=>`<figure><img src="${await data(c.id)}"><figcaption>${c.id} · ${c.title}</figcaption></figure>`))).join('')}</main>`);
await card.screenshot({path:path.join(out,'contact-sheet.png'),fullPage:true});
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),catalogCount:models.length,publicationStatus:'Not published',captures},null,2));
await fs.writeFile(path.join(out,'README.md'),`# Liminal update image pack\n\nCaptured from the current local UI on ${new Date().toISOString()}.\n\n- 01–07: current web application, API responses isolated to a demo workspace. No fabricated completed tasks or performance claims.\n- 08–10: social cards, 2400×1260 (2× 1200×630).\n- 11: real Windows Release app hub crop. Account footer, conversation history and notifications excluded.\n- Web images: 2400×1650; mobile: 645×1398.\n\nModel counts reflect the capture date. Single-model mode disables separate embeddings, hosted speech, and automatic model fallbacks; vision depends on the selected model's capability.\n\nThese images show the interface included in the 0.1.4 desktop and harness update. They are product screenshots, not evidence of completed agent work or response-time guarantees.\n\nRecommended: 08 for general introduction; 09 for model choice; 10 for simplified setup. Use 02–06 on feature pages. Native image is deliberately a detail crop.\n\nNo uploads or public posts were made. See manifest.json for provenance. Re-run: node scripts/capture-update-marketing.mjs (Vite client running on :5173).\n`);
if(failures.length)throw Error(failures.join('\n'));
await browser.close();console.log(`Captured ${captures.length} images + contact sheet in ${out}`);
