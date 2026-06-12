import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RemoteSessionGrant } from "@liminal/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RemoteJoinHandlerDeps {
  resolveCode: (code: string) => RemoteSessionGrant | null;
  loopbackPort: number;
  lanPort: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function loadViewerHtml(): Promise<string> {
  const paths = [
    join(__dirname, "remote-viewer", "index.html"),
    join(__dirname, "..", "remote-viewer", "index.html"),
  ];
  for (const p of paths) {
    try {
      return await readFile(p, "utf8");
    } catch {
      /* try next */
    }
  }
  return FALLBACK_VIEWER_HTML;
}

const FALLBACK_VIEWER_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Liminal Remote</title>
<style>
body{margin:0;background:#0a0e14;color:#dde8f0;font-family:system-ui,sans-serif}
#app{padding:12px;max-width:720px;margin:0 auto}
.msg{margin:8px 0;padding:8px 10px;border-radius:4px;background:#111820;border:1px solid #1e2a36}
.msg.user{border-color:#2a4a5a}
.msg.assistant{border-color:#1a3a2a}
.tool{font-size:12px;color:#8aa0b4;margin-top:4px}
#status{font-size:12px;color:#6a8a9a;margin-bottom:12px}
input,button{font:inherit}
#composer{display:none;margin-top:12px;gap:8px}
#composer.control{display:flex}
#composer input{flex:1;padding:8px;background:#0d1218;border:1px solid #2a3a48;color:#dde8f0;border-radius:4px}
#composer button{padding:8px 12px;background:#1a4a3a;border:1px solid #2a6a4a;color:#dde8f0;border-radius:4px;cursor:pointer}
</style></head><body>
<div id="app"><div id="status">Connecting…</div><div id="log"></div>
<div id="composer"><input id="input" placeholder="Message…"/><button type="button" id="send">Send</button></div></div>
<script>
const params=new URLSearchParams(location.search);
const code=params.get('code')||'';
const logEl=document.getElementById('log');
const statusEl=document.getElementById('status');
const composer=document.getElementById('composer');
const input=document.getElementById('input');
let role='view',chatId='',cmdId=0,ws=null;
function addMsg(kind,text,extra){const d=document.createElement('div');d.className='msg '+kind;
d.textContent=(kind==='user'?'You: ':'')+text;if(extra){const t=document.createElement('div');t.className='tool';t.textContent=extra;d.appendChild(t);}
logEl.appendChild(d);logEl.scrollTop=logEl.scrollHeight;}
function sendCmd(command,data){const id='c'+(++cmdId);ws.send(JSON.stringify({t:'cmd',v:1,id,command,data}));return id;}
fetch('/remote/resolve?code='+encodeURIComponent(code)).then(r=>r.json()).then(cfg=>{
if(!cfg.ok)throw new Error(cfg.error||'resolve failed');
role=cfg.role||'view';chatId=cfg.chatId;
const proto=location.protocol==='https:'?'wss:':'ws:';
ws=new WebSocket(proto+'//'+location.host+'?join='+encodeURIComponent(cfg.joinToken));
ws.onmessage=(ev)=>{try{const f=JSON.parse(ev.data);if(f.t!=='evt')return;const p=f.p||{};
if(f.e==='text')addMsg('assistant',p.text||'');
if(f.e==='transcript_replay'&&Array.isArray(p.entries))p.entries.forEach(e=>{if(e.text)addMsg(e.kind==='user'?'user':'assistant',e.text);});
if(f.e==='tool_start')addMsg('assistant','','Tool: '+p.toolName);
if(f.e==='hello'||f.e==='sidecar_ready'){statusEl.textContent='Connected ('+role+') · '+chatId;if(role==='control')composer.classList.add('control');}
}catch(e){console.error(e);}};
ws.onclose=()=>{statusEl.textContent='Disconnected';};
document.getElementById('send').onclick=()=>{const m=input.value.trim();if(!m||!ws||role!=='control')return;
sendCmd('send_message',{chatId,message:m});addMsg('user',m);input.value='';};
}).catch(e=>{statusEl.textContent='Error: '+e.message;});
</script></body></html>`;

export function tryHandleRemoteJoinRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RemoteJoinHandlerDeps
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/remote/resolve" && req.method === "GET") {
    const code = url.searchParams.get("code")?.trim() ?? "";
    const grant = deps.resolveCode(code);
    if (!grant) {
      sendJson(res, 404, { ok: false, error: "Invalid or expired join code" });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      joinToken: grant.joinToken,
      chatId: grant.chatId,
      role: grant.role,
      expiresAt: grant.expiresAt,
      wsPort: deps.lanPort,
      loopbackPort: deps.loopbackPort,
    });
    return true;
  }

  if (path === "/remote/join" && req.method === "GET") {
    void (async () => {
      const html = await loadViewerHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    })();
    return true;
  }

  return false;
}
