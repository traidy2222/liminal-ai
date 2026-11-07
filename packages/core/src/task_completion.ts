import {randomUUID} from 'node:crypto';
/** Per-turn requested outcomes, grounded in successful returned observations.
 * No model/judge calls and no site-specific matching. A click receipt is not evidence.
 */
export type OutcomeUpdate = {id:string;status:'completed'|'blocked';reason?:string;subject?:string;evidence?:{observation_id:string;quote:string}[]};
type Outcome = {id:string;description:string;status:'pending'|'completed'|'blocked';reason?:string;evidence?:{observation_id:string;quote:string}[]};
const normalize=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const browserObservation=/^browser_(open|act|navigate|snapshot|extract|wait_for|search)$/;
const bookkeeping=new Set(['plan','think','reason','breakdown','list_tool_families','activate_tool_family','mcp_search_tools','browser_tabs','browser_credentials']);
export class TaskCompletionLedger {
 active=false;
 configured=false;
 private items:Outcome[]=[];
 private observations=new Map<string,string>();
 private nextObservation=0;
 private browserCalls=0;
 private seeded:string[];
 private evidencePrefix:string;
 constructor(readonly request:string,options:{previous?:TaskCompletionLedger;idPrefix?:string}={}){
  this.evidencePrefix=options.previous?.evidencePrefix??options.idPrefix??randomUUID().slice(0,8);
  if(options.previous){this.observations=new Map(options.previous.observations);this.nextObservation=options.previous.nextObservation;}

  // Structural enumeration only: semantic decomposition remains with the main
  // model. Keep explicit items so a later summary cannot silently drop one.
  this.seeded=request.split(/\r?\n/).flatMap(line=>{
   const match=/^\s*(?:[-*•]|\d+[.)])\s+(.{3,300})$/.exec(line);
   return match?[match[1]!]:[];
  }).slice(0,40);
 }
 get outcomes():ReadonlyArray<Readonly<Outcome>>{return this.items;}
 get pending(){return this.items.filter(x=>x.status==='pending');}
 get blocked(){return this.items.filter(x=>x.status==='blocked');}
 get needsReview(){return this.active&&(!this.configured||this.pending.length>0);}
 get holdFinal(){return this.active&&(this.needsReview||this.blocked.length>0);}
 observe(name:string,ok:boolean,output:string):string|undefined{
  let recordedAccount=false;
  if(name==='browser_credentials'&&ok){try{const receipt=JSON.parse(output);recordedAccount=receipt.available_in_new_chats===true&&receipt.evidence==='matched_current_page'&&typeof receipt.account?.id==='string';}catch{/* Non-receipt credential results are not evidence. */}}
  if(bookkeeping.has(name)&&!recordedAccount)return undefined;
  if(browserObservation.test(name))this.browserCalls++;
  if(!this.active&&browserObservation.test(name)&&(this.seeded.length>1||this.browserCalls>=3)){
   this.active=true;this.add(this.seeded);
  }
  if(!ok)return undefined;
  // Keep page evidence, excluding action receipts and field-value echoes.
  const evidence=output.split('\n').flatMap(line=>{
   // A compact delta's text is current rendered content, not an old-value diff.
   if(line.startsWith('CONTENT_CHANGE: ')){try{const value=JSON.parse(line.slice('CONTENT_CHANGE: '.length));return typeof value.text==='string'?[value.text]:[];}catch{return [];}}
   if(/^\s*(?:ACTIONS_EXECUTED|ACTION_PROGRESS|SESSION_ID|SCREENSHOT_PATH|NATIVE_BROWSER_IMAGE|OBSERVED_AT|OBSERVATION_|CHANGED_REFS|EXPIRED_REFS):/.test(line)||/^\s*e\d+\s+(?:textbox|combobox|searchbox)\b/.test(line))return [];
   return [line];
  }).join('\n').slice(0,32000);
  const id='o-'+this.evidencePrefix+'-'+(++this.nextObservation);this.observations.set(id,normalize(evidence));
  while(this.observations.size>120)this.observations.delete(this.observations.keys().next().value!);
  return id;
 }
 private add(descriptions:string[]){
  for(const raw of descriptions){const description=raw.trim().slice(0,400);if(!description||this.items.some(x=>normalize(x.description)===normalize(description)))continue;
   if(this.items.length>=60)throw Error('At most 60 requested outcomes can be tracked.');
   this.items.push({id:'t'+(this.items.length+1),description,status:'pending'});
  }
 }
 update(input:{outcomes?:string[];updates?:OutcomeUpdate[]}):{ok:true;output:string}|{ok:false;error:string}{
  // Validate the entire batch first: failed updates cannot partially change state.
  const snapshot=this.items.map(x=>({...x})),wasActive=this.active,wasConfigured=this.configured;
  try{
   if(input.outcomes){if(!input.outcomes.length||input.outcomes.some(s=>typeof s!=='string'||!s.trim()))throw Error('outcomes must contain nonempty requested results.');this.add(input.outcomes);this.active=true;this.configured=true;}
   for(const update of input.updates??[]){
    const item=this.items.find(x=>x.id===update.id);if(!item)throw Error('Unknown outcome '+update.id+'. Read the current ledger IDs.');
    if(update.status==='blocked'){
     if(!update.reason?.trim())throw Error('A blocked outcome needs the actual blocker.');
     item.status='blocked';item.reason=update.reason.trim().slice(0,400);continue;
    }
    if(update.status!=='completed')throw Error('Use completed or blocked; unreported work stays pending.');
    if(!update.evidence?.length)throw Error('Completion needs an observation_id and a quote from returned page state, not a click receipt.');
    for(const proof of update.evidence){
     const observed=this.observations.get(proof.observation_id),quote=normalize(proof.quote??'');
     if(!observed||quote.length<8||quote.length>700||!observed.includes(quote))throw Error('Evidence does not match retained page state for '+item.id+'. Use an existing successful observation and an exact visible quote.');
    }
    // Explicit enumerated item names must be present in the cited state. This
    // prevents using evidence for five siblings to tick the missing sixth.
    if(this.seeded.some(s=>normalize(s)===normalize(item.description))){
     const subject=normalize(update.subject??item.description);
     if(subject.length<3||!normalize(item.description).includes(subject))throw Error('subject must name the requested item within its original description.');
     if(!update.evidence.some(proof=>this.observations.get(proof.observation_id)?.includes(subject)))throw Error('No observed page state contains the requested item '+item.id+': '+item.description);
    }
    item.status='completed';item.evidence=update.evidence.map(p=>({...p}));delete item.reason;
   }
   return {ok:true,output:this.render()};
  }catch(e){this.items=snapshot;this.active=wasActive;this.configured=wasConfigured;return {ok:false,error:(e as Error).message+'\n'+this.render()};}
 }
 render():string{
  if(!this.active)return '';
  const header='[REQUESTED OUTCOMES] '+this.items.filter(x=>x.status==='completed').length+'/'+this.items.length+' supported; '+this.pending.length+' pending; '+this.blocked.length+' blocked.';
  const guide=!this.configured?' Use plan({outcomes:[...]}) to capture the requested results, including details implicit in the request.':' Use plan({updates:[{id,status:"completed",evidence:[{observation_id,quote}]}]}) to batch progress from existing page evidence; blocked needs reason. Continue pending work; do not recheck completed results.';
  return header+guide+'\n'+this.items.map(x=>`${x.id} ${x.status}: ${x.description}${x.reason?' — '+x.reason:''}`).join('\n');
 }
 handoff():string{
  const remaining=this.items.filter(x=>x.status!=='completed');
  return 'Work is incomplete. '+(!this.configured?'The requested outcomes have not been reconciled with the observed results. ':'')+(remaining.length?'Remaining: '+remaining.map(x=>x.description+(x.reason?' ('+x.reason+')':'')).join('; ')+'.':'');
 }
}
