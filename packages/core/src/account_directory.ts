import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {globalPath,notesPaths,pickReadPath} from './global_storage.js';

export type AccountStatus='prepared'|'reported'|'active'|'blocked'|'closed';
export type AccountLoginMethod='password'|'email_code'|'magic_link'|'oauth'|'unknown';
export type AccountOwner='assistant'|'user'|'unknown';
export interface SavedAccount {
 id:string;origin:string;username:string;email?:string;service:string;owner:AccountOwner;
 status:AccountStatus;loginMethod?:AccountLoginMethod;credentialId?:string;profileUrl?:string;sourceNote?:string;sourceChat?:string;updatedAt:string;
}
type AccountInput=Omit<SavedAccount,'id'|'updatedAt'|'service'|'owner'> & {service?:string;owner?:AccountOwner};
const statuses=new Set<AccountStatus>(['prepared','reported','active','blocked','closed']);
const loginMethods=new Set<AccountLoginMethod>(['password','email_code','magic_link','oauth','unknown']);
const owners=new Set<AccountOwner>(['assistant','user','unknown']);
const imported=new Map<string,string>();
const directory=()=>globalPath('accounts');
const clean=(value:string,max:number)=>value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
export function accountSafeUrl(value:string):string {
 if(value.length>4096)throw Error('Account URL is too long');
 const u=new URL(value);
 if(u.username||u.password||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Account URL must use HTTPS or a local test site');
 u.search='';u.hash='';return u.href;
}
export function listSavedAccounts():SavedAccount[]{
 if(!fs.existsSync(directory()))return [];
 return fs.readdirSync(directory()).filter(f=>/^[a-f0-9]{32}\.json$/.test(f)).flatMap(file=>{
  try{const v=JSON.parse(fs.readFileSync(path.join(directory(),file),'utf8'));
   if(!v||typeof v.username!=='string'||typeof v.origin!=='string'||!statuses.has(v.status)||!owners.has(v.owner))return [];
   return [{id:file.slice(0,-5),origin:new URL(accountSafeUrl(v.origin)).origin,username:clean(v.username,160),service:clean(String(v.service||new URL(v.origin).hostname),80),owner:v.owner,status:v.status,
    ...(typeof v.email==='string'&&/^[^\s@]+@[^\s@]+$/.test(v.email)?{email:clean(v.email,254)}:{}),
    ...(loginMethods.has(v.loginMethod)?{loginMethod:v.loginMethod}:{}),
    ...(typeof v.credentialId==='string'&&/^[a-f0-9-]{36}$/.test(v.credentialId)?{credentialId:v.credentialId}:{}),
    ...(typeof v.profileUrl==='string'?{profileUrl:accountSafeUrl(v.profileUrl)}:{}),
    ...(typeof v.sourceNote==='string'?{sourceNote:clean(v.sourceNote,160)}:{}),
    ...(typeof v.sourceChat==='string'?{sourceChat:clean(v.sourceChat,160)}:{}),updatedAt:String(v.updatedAt||'')} as SavedAccount];
  }catch{return [];}
 }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
}
/** Metadata only. Whitelist fields rather than copying model objects. */
export function saveAccount(input:AccountInput):SavedAccount {
 const origin=new URL(accountSafeUrl(input.origin)).origin,username=clean(input.username,160);
 if(!username||!statuses.has(input.status)||input.owner!==undefined&&!owners.has(input.owner))throw Error('Invalid account metadata');
 if(input.loginMethod!==undefined&&!loginMethods.has(input.loginMethod))throw Error('Invalid login method');
 if(input.credentialId&&!/^[a-f0-9-]{36}$/.test(input.credentialId))throw Error('Invalid credential reference');
 const email=input.email&&/^[^\s@]+@[^\s@]+$/.test(input.email)?clean(input.email,254):undefined;
 const site=(url:string)=>{const u=new URL(url);return u.protocol+'//'+u.host.replace(/^www\./i,'');};
 const same=listSavedAccounts().filter(a=>site(a.origin)===site(origin));
 const exact=same.find(a=>a.username.toLowerCase()===username.toLowerCase()||a.email?.toLowerCase()===username.toLowerCase()||input.credentialId&&a.credentialId===input.credentialId);
 const aliases=same.filter(a=>email?.split('@')[0]?.toLowerCase()===a.username.toLowerCase()||a.email?.split('@')[0]?.toLowerCase()===username.toLowerCase());
 const sameSignup=same.filter(a=>input.sourceChat&&a.sourceChat===input.sourceChat&&a.status==='prepared'&&a.credentialId);
 const old=exact??(aliases.length===1?aliases[0]:undefined)??(sameSignup.length===1?sameSignup[0]:undefined);
 const id=old?.id??createHash('sha256').update(origin+'\n'+username.toLowerCase()).digest('hex').slice(0,32);
 const status=old&&(input.status==='prepared'||input.status==='reported'&&old.status!=='prepared'&&old.status!=='reported')?old.status:input.status;
 // A generated local password is a candidate credential, not evidence that the
 // website uses or accepted it. Authentication stays unknown until recorded.
 const loginMethod=input.loginMethod??old?.loginMethod??'unknown';
 const credentialId=!['email_code','magic_link','oauth'].includes(loginMethod)?(input.credentialId??old?.credentialId):undefined;
 const account:SavedAccount={id,origin:input.status==='reported'&&old?.credentialId?old.origin:origin,username:old&&input.status==='prepared'?old.username:username,
  service:clean(input.service||old?.service||new URL(origin).hostname,80),owner:input.owner&&input.owner!=='unknown'?input.owner:old?.owner??'unknown',status,loginMethod,
  ...(email||old?.email?{email:email||old?.email}:{}),...(credentialId?{credentialId}:{}),
  ...(input.profileUrl||old?.profileUrl?{profileUrl:accountSafeUrl((input.status==='prepared'||input.status==='reported')&&old?.profileUrl?old.profileUrl:input.profileUrl||old!.profileUrl!)}:{}),
  ...(input.sourceNote||old?.sourceNote?{sourceNote:clean(input.sourceNote||old!.sourceNote!,160)}:{}),
  ...(input.sourceChat||old?.sourceChat?{sourceChat:clean(input.sourceChat||old!.sourceChat!,160)}:{}),updatedAt:new Date().toISOString()};
 const removeDuplicates=()=>{for(const a of same)if(a.id!==id&&(a.username.toLowerCase()===account.username.toLowerCase()||a.credentialId&&a.credentialId===account.credentialId))fs.rmSync(path.join(directory(),a.id+'.json'),{force:true});};
 if(old&&[...new Set([...Object.keys(old),...Object.keys(account)])].every(key=>key==='updatedAt'||(old as unknown as Record<string,unknown>)[key]===(account as unknown as Record<string,unknown>)[key])){removeDuplicates();return old;}
 fs.mkdirSync(directory(),{recursive:true,mode:0o700});const target=path.join(directory(),id+'.json'),temp=target+'.'+randomUUID()+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(account),{mode:0o600});fs.renameSync(temp,target);removeDuplicates();return account;
}

/** Compatibility for explicit global account facts, never failure trajectories. */
export function indexAccountMemory(key:string,value:string,scope?:string,sourceChat?:string):SavedAccount|undefined {
 if(scope!=='global'||!/^(?:fact|entity):/.test(key)||!/account/i.test(key))return;
 const text=value.split('\n').filter(line=>!(/password|passphrase|secret|token|api.?key/i.test(line))).join('\n');
 if(!/\b(?:created|registered|logged[ -]in)\b/i.test(text)||/\b(?:not|never|failed|unable|cannot)\b[^.\n]{0,45}\b(?:created|registered|logged[ -]in)\b/i.test(text))return;
 const email=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
 const explicit=text.match(/\bOrigin:\s*(https?:\/\/[^\s<>]+)/i)?.[1];
 const url=explicit??text.match(/https:\/\/[^\s<>]+/i)?.[0]?.replace(/[)\],;.]+$/,'');
 // A contact email's domain is not the service the note describes.
 const leading=text.replace(/^\[migrated_to_vault:[^\]]+\]\s*/,'');
 const domain=!url?leading.match(/^([a-z0-9-]+\.[a-z]{2,})(?:\s|\s*\()/i)?.[1]:undefined;
 const origin=url?new URL(accountSafeUrl(url)).origin:domain?'https://'+domain:undefined;
 const username=text.match(/\bUsername:\s*([^\s(\n]+)/i)?.[1]?.replace(/^[`"']|[`"',;]$/g,'')??email;
 if(!origin||!username)return;
 // Free-text notes cannot attach a credential from a different service.
 const requestedId=text.match(/\b(?:credential(?: store)?(?: id)?):\s*([a-f0-9-]{36})\b/i)?.[1];
 const credentialId=requestedId&&listSavedAccounts().find(a=>a.credentialId===requestedId&&a.origin===origin)?.credentialId;
 return saveAccount({origin,username,email,status:'reported',sourceNote:key,sourceChat,...(url&&!explicit?{profileUrl:url}:{}),...(credentialId?{credentialId}:{})});
}
export async function importAccountMemories():Promise<void>{
 const file=await pickReadPath(notesPaths());
 try{const stat=fs.statSync(file),revision=stat.mtimeMs+':'+stat.size;if(imported.get(file)===revision)return;
  const notes=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const [key,note] of Object.entries(notes)){if(!note||typeof note!=='object')continue;const n=note as {value?:string;text?:string;scope?:string};
   try{indexAccountMemory(key,n.value??n.text??'',n.scope);}catch{/* Malformed notes must not block a turn. */}
  }imported.set(file,revision);
 }catch{/* No existing notes. */}
}
export async function savedAccountContext(query:string):Promise<string>{
 await importAccountMemories();const tokens=query.toLowerCase().match(/[a-z0-9.-]{4,}/g)??[];
 const relevance=(a:SavedAccount)=>tokens.reduce((sum,t)=>sum+Number((a.service+' '+a.origin+' '+a.username+' '+(a.email||'')).toLowerCase().includes(t)),0);
 const all=listSavedAccounts(),selected=all.filter(a=>a.status==='active'||a.status==='reported'||relevance(a)>0)
  .sort((a,b)=>relevance(b)-relevance(a)||Number(b.owner==='assistant')-Number(a.owner==='assistant')||b.updatedAt.localeCompare(a.updatedAt)).slice(0,8);
 if(!selected.length)return '';
 const rows:Record<string,unknown>[]=[];
 for(const a of selected){const row={account_id:a.id,service:a.service,origin:a.origin,username:a.username,...(a.email?{email:a.email}:{}),owner:a.owner,status:a.status,login_method:a.loginMethod??'unknown',local_password:a.credentialId?'stored':'not_stored',...(a.credentialId?{credential_id:a.credentialId}:{}),...(a.profileUrl&&a.profileUrl.length<=500?{profile_url:a.profileUrl}:{})};if(JSON.stringify([...rows,row]).length>5000)continue;rows.push(row);}
 return 'SAVED ACCOUNTS (shared local metadata; active=observed signed-in, reported=existing memory not reverified, prepared=signup unconfirmed; passwords remain in encrypted browser_credentials):\n'+JSON.stringify(rows)+(all.length>rows.length?'\nAdditional entries are available with browser_credentials action=accounts.':'');
}
