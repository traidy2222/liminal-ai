import test from 'node:test';import assert from 'node:assert/strict';
import {ContextManager} from './context.js';
import {estimateMessagesTokens} from './token_estimate.js';
import {resolveUserTurnWithAttachments} from './image_attachments.js';
import {omitUnsupportedImagePixels} from './native_vision.js';

const fixture=()=>new ContextManager({inceptionMessages:[{role:'system',content:'Stable prefix'}],modelMaxTokens:100000,thresholdFraction:.95});
const pixel=(value:string)=>'data:image/png;base64,'+Buffer.from(value).toString('base64');
test('tool pixels follow the entire result batch without becoming user turns or saved transcript',async()=>{
 const ctx=fixture();ctx.append({role:'user',content:'Inspect the page'});
 ctx.append({role:'assistant',tool_calls:[{id:'one',type:'function',function:{name:'browser_open',arguments:'{}'}},{id:'two',type:'function',function:{name:'read_file',arguments:'{}'}}]});
 ctx.setImageObservation('browser:one','Observed viewport',pixel('first'));
 ctx.append({role:'tool',tool_call_id:'one',content:'Page opened'});ctx.append({role:'tool',tool_call_id:'two',content:'Read complete'});
 const messages=await ctx.buildMessages();const image=messages.findIndex(m=>Array.isArray(m.content));
 assert.ok(image>messages.findIndex(m=>m.role==='tool'&&m.tool_call_id==='two'));
 assert.equal(ctx.getConversationMessages().some(m=>Array.isArray(m.content)),false);
 assert.equal(ctx.getLastUserMessage(),'Inspect the page');
 assert.equal(messages[0]?.content,'Stable prefix');
 assert.ok(estimateMessagesTokens(messages)>=1600);
});
test('tool images replace stale views, stay bounded and clear for the next user turn',async()=>{
 const ctx=fixture(),other=fixture();
 ctx.setImageObservation('browser:a','Old page',pixel('old'));ctx.setImageObservation('browser:a','New page',pixel('new'));
 ctx.setImageObservation('browser:b','Second tab',pixel('second'));ctx.setImageObservation('upload','Uploaded image',pixel('third'));
 const messages=await ctx.buildMessages();assert.equal(messages.filter(m=>Array.isArray(m.content)).length,2);
 assert.ok(!JSON.stringify(messages).includes(pixel('old')));assert.ok(!JSON.stringify(messages).includes(pixel('new')));
 assert.equal(other.hasImageObservations(),false);
 ctx.clearTurnContext();assert.equal(ctx.hasImageObservations(),false);
 assert.throws(()=>ctx.setImageObservation('bad','not an image','https://example.com/not-an-image'),/Invalid/);
});
test('removing a failed browser observation retains unrelated uploaded pixels',async()=>{
 const ctx=fixture();ctx.setImageObservation('browser:a','Old page',pixel('old'));ctx.setImageObservation('upload','User reference',pixel('reference'));ctx.removeImageObservation('browser:a');assert.equal(ctx.hasImageObservation('browser:a'),false);assert.equal(ctx.hasImageObservation('upload'),true);
});
test('native DeepSeek user attachments are pixels; unsupported models receive honest metadata without base64 text',async()=>{
 const image={name:'image.png',mimeType:'image/png' as const,dataUrl:pixel('fixture'),sizeBytes:7,source:'clipboard' as const};
 const native=await resolveUserTurnWithAttachments('Read it',[image],'deepseek/deepseek-v4.1-flash-1017');
 assert.ok(Array.isArray(native));assert.equal(native[1]?.type,'image_url');
 const fallback=await resolveUserTurnWithAttachments('Read it',[image],'offline-text','http://127.0.0.1:1');
 assert.equal(typeof fallback,'string');assert.match(String(fallback),/IMAGE_INPUT_UNAVAILABLE/);
 assert.ok(!String(fallback).includes(image.dataUrl));assert.ok(!String(fallback).includes('vision_analyze'));
 const history=[{role:'user' as const,content:native as any}];
 const textOnly=omitUnsupportedImagePixels(history);
 assert.ok(!JSON.stringify(textOnly).includes('image_url'));assert.match(JSON.stringify(textOnly),/pixels omitted/);
 assert.ok(JSON.stringify(history).includes('image_url'),'the saved history must remain available when switching back');
});
