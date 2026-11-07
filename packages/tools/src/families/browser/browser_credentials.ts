import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { protectLocalSecret, unprotectLocalSecret,saveAccount } from "@liminal/core";
import { browserProfileRoot } from "./browser_profile.js";

type SavedLogin = { id: string; origin: string; username: string; encryptedPassword: string; createdAt: number; lastFilledAt?:number };
const usage=(login:SavedLogin)=>({passwordState:login.lastFilledAt?'filled':'stored',...(Number.isFinite(login.lastFilledAt)?{lastFilledAt:login.lastFilledAt}:{})});
function directory(): string { return path.join(browserProfileRoot(), "credentials"); }
function safeOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) {
    throw new Error("Saved logins require HTTPS (or a local test server)");
  }
  return parsed.origin;
}
export function savedBrowserLogins(url: string) {
  const origin = safeOrigin(url);
  if (!fs.existsSync(directory())) return [];
  return fs.readdirSync(directory()).filter(f => /^[a-f0-9-]+\.json$/.test(f)).flatMap(file => {
    try { const data = JSON.parse(fs.readFileSync(path.join(directory(), file), "utf8")) as SavedLogin;
      return data.origin === origin ? [{ id: data.id, origin, username: data.username, createdAt: data.createdAt,...usage(data) }] : [];
    } catch { return []; }
  });
}
/** Enumerate metadata only; used to link older secure logins to account records. */
export function browserLoginMetadata(){
 if(!fs.existsSync(directory()))return [];
 return fs.readdirSync(directory()).filter(f=>/^[a-f0-9-]+\.json$/.test(f)).flatMap(file=>{
  try{const data=JSON.parse(fs.readFileSync(path.join(directory(),file),'utf8')) as SavedLogin;
   if(!/^[a-f0-9-]{36}$/.test(data.id)||typeof data.username!=='string')return [];
   return [{id:data.id,origin:safeOrigin(data.origin),username:data.username,createdAt:data.createdAt,...usage(data)}];
  }catch{return [];}
 });
}
export function indexBrowserLoginMetadata(){
 for(const login of browserLoginMetadata())saveAccount({origin:login.origin,username:login.username,credentialId:login.id,status:'prepared'});
}
/** Persist successful tool use so a new chat can distinguish stored from filled. */
export function markBrowserLoginFilled(id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid saved login id');
 const target=path.join(directory(),id+'.json'),login=JSON.parse(fs.readFileSync(target,'utf8')) as SavedLogin;
 if(login.id!==id)throw Error('Saved login identity mismatch');
 const updated={...login,lastFilledAt:Date.now()},temp=target+'.'+randomUUID()+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(updated),{mode:0o600});fs.renameSync(temp,target);
}
/** A site may shorten or canonicalize a signup name. Update only the login
 * identifier after confirmation; the encrypted password and origin stay intact. */
export function updateBrowserLoginUsername(id:string,username:string){
 if(!/^[a-f0-9-]{36}$/.test(id)||!username.trim()||username.length>160)throw Error('Invalid saved login identifier');
 const target=path.join(directory(),id+'.json'),login=JSON.parse(fs.readFileSync(target,'utf8')) as SavedLogin;
 if(login.id!==id)throw Error('Saved login identity mismatch');
 if(login.username!==username){const temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({...login,username}),{mode:0o600});fs.renameSync(temp,target);}
 return {id:login.id,origin:safeOrigin(login.origin),username,createdAt:login.createdAt};
}
export function prepareBrowserLogin(url: string, username: string) {
  const origin = safeOrigin(url);
  if (!username.trim()) throw new Error("A username is required before preparing a login");
  const existing = savedBrowserLogins(url).find(login => login.username === username);
  if (existing) {saveAccount({origin,username,credentialId:existing.id,status:'prepared'});return existing;}
  const login: SavedLogin = { id: randomUUID(), origin, username, createdAt: Date.now(),
    encryptedPassword: protectLocalSecret(randomBytes(24).toString("base64url") + "aA1!") };
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory(), `${login.id}.json`), JSON.stringify(login), { mode: 0o600, flag: "wx" });
  saveAccount({origin,username,credentialId:login.id,status:'prepared'});
  return { id: login.id, origin, username, createdAt: login.createdAt,...usage(login) };
}
/** Only browser runtime may use the returned secret. Never return it as a tool result. */
export function readBrowserLoginForFill(url: string, id: string): { username: string; password: string } {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid saved login id");
  const login = JSON.parse(fs.readFileSync(path.join(directory(), `${id}.json`), "utf8")) as SavedLogin;
  if (login.origin !== safeOrigin(url)) throw new Error("Saved login belongs to a different origin; navigate to its actual sign-in site");
  return { username: login.username, password: unprotectLocalSecret(login.encryptedPassword) };
}
