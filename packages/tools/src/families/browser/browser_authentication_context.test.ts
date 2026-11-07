import test from 'node:test';import assert from 'node:assert/strict';
import {BrowserObservations,formatBrowserSnapshot} from './browser_observation.js';
import {chromium} from 'playwright';import {buildPageSnapshot} from '../../../dist/families/browser/browser_runtime.js';
test('authentication metadata updates and clears across same-URL observations',()=>{
 const observations=new BrowserObservations(),snapshot=(authentication?:unknown)=>formatBrowserSnapshot({observedAt:{iso:'fixture'},authentication,contexts:['main'],controls:[],readable:'Account',tree:''});
 const initial=observations.format('https://example.test/account',snapshot({site_password_exists:'unknown',local_passwords:[]}));assert.match(initial,/AUTHENTICATION_CONTEXT/);
 const updated=observations.format('https://example.test/account',snapshot({site_password_exists:'unknown',local_passwords:[{credential_id:'fixture',state:'filled'}]}));assert.match(updated,/"state":"filled"/);
 const cleared=observations.format('https://example.test/account',snapshot());assert.match(cleared,/AUTHENTICATION_CONTEXT: null/);
});
test('a generic settings label cannot turn Change password into proof of an existing password',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<h1>Authentication</h1><button aria-label="Upgrade your plan to use this feature">Change password</button>');const snapshot=await buildPageSnapshot(page);const line=snapshot.snapshotText.split('\n').find(line=>line.startsWith('AUTHENTICATION_CONTEXT: '));assert.ok(line);const state=JSON.parse(line.slice('AUTHENTICATION_CONTEXT: '.length));assert.equal(state.site_password_exists,'unknown');assert.deepEqual(state.local_passwords,[]);
 }finally{await browser.close();}
});
