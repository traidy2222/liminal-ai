/**
 * captcha_solve — resolves reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs
 * via 2captcha or CapSolver. Optionally auto-detects the site key from a live browser session
 * and injects the solved token directly into the DOM.
 *
 * Env: AGENT_CAPTCHA_KEY (secret), AGENT_CAPTCHA_SERVICE (2captcha|capsolver, default 2captcha),
 *      AGENT_CAPTCHA_TIMEOUT_MS (default 120000), AGENT_CAPTCHA_POLL_MS (default 3000).
 */
import { defineTool } from "../../shared/helpers.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import {
  checkBrowserSessionOwner,selectBrowserTaskTab,
  browserWorkspaceState,
  ensureBrowserSessionActive,
  injectCaptchaToken,
  readCaptchaSubmissionState,
  detectCaptchaInBrowserSession,
  getBrowserSession,buildPageSnapshot,browserVisualTarget,inspectBrowserVisualTargets,snapshotBrowserSession,
  type CaptchaType,
} from "./browser_runtime.js";
import { isCurrentBrowserTabHandle } from "./browser_navigation_context.js";
import { withBrowserTask } from "./browser_queue.js";
import {captureCaptchaRegion,solveCoordinateImage} from './captcha_coordinates.js';
import {solveVisualDrag} from './captcha_visual_drag.js';
import {attachNativeImage} from '../vision/upload_image.js';
import {attachBrowserImage,invalidateBrowserImage} from './browser_native_images.js';

/** CaptchaType extended with image-only type not applicable to DOM detection. */
type CaptchaSolveType = CaptchaType | "image";

type CaptchaService = "2captcha" | "capsolver";

function captchaKey(): string {
  return effectiveHarnessEnvRaw("AGENT_CAPTCHA_KEY")?.trim() ?? "";
}

function captchaService(): CaptchaService {
  const s = effectiveHarnessEnvRaw("AGENT_CAPTCHA_SERVICE")?.trim().toLowerCase() ?? "";
  return s === "capsolver" ? "capsolver" : "2captcha";
}

function captchaTimeoutMs(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_CAPTCHA_TIMEOUT_MS") ?? "120000", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300_000) : 120_000;
}

function captchaPollMs(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_CAPTCHA_POLL_MS") ?? "3000", 10);
  return Number.isFinite(n) && n > 0 ? Math.max(1000, Math.min(n, 15_000)) : 3_000;
}

// ─── 2captcha ──────────────────────────────────────────────────────────────────

async function submit2Captcha(
  key: string,
  type: CaptchaSolveType,
  siteKey: string,
  pageUrl: string,
  action: string | undefined,
  minScore: number | undefined,
  imageBase64: string | undefined
): Promise<string> {
  const params = new URLSearchParams({ key, json: "1" });

  if (type === "image") {
    if (!imageBase64) throw new Error("image type requires image_base64");
    params.set("method", "base64");
    params.set("body", imageBase64);
  } else if (type === "recaptcha_v2") {
    params.set("method", "userrecaptcha");
    params.set("googlekey", siteKey);
    params.set("pageurl", pageUrl);
  } else if (type === "recaptcha_v3") {
    params.set("method", "userrecaptcha");
    params.set("version", "v3");
    params.set("googlekey", siteKey);
    params.set("pageurl", pageUrl);
    params.set("action", action ?? "verify");
    params.set("min_score", String(minScore ?? 0.7));
  } else if (type === "hcaptcha") {
    params.set("method", "hcaptcha");
    params.set("sitekey", siteKey);
    params.set("pageurl", pageUrl);
  } else if (type === "turnstile") {
    params.set("method", "turnstile");
    params.set("sitekey", siteKey);
    params.set("pageurl", pageUrl);
  }

  const submitRes = await fetch("https://2captcha.com/in.php", {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(30_000),
  });
  if (!submitRes.ok) throw new Error(`2captcha submit HTTP ${submitRes.status}`);
  const submitData = (await submitRes.json()) as { status: number; request: string };
  if (submitData.status !== 1) throw new Error(`2captcha submit error: ${submitData.request}`);
  return submitData.request; // task ID
}

export async function poll2Captcha(key: string, taskId: string, timeoutMs: number, pollMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollMs));
    try {
      const endpoint = new URL("https://2captcha.com/res.php");
      endpoint.search = new URLSearchParams({key, action:"get", id:taskId, json:"1"}).toString();
      const res = await fetch(
        endpoint,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { status: number; request: string };
      if (data.status === 1 && data.request?.trim()) return data.request;
      if (data.status === 1) throw new Error("2Captcha returned an empty solution");
      if (data.request !== "CAPCHA_NOT_READY") throw new Error("2Captcha poll error: " + String(data.request).replaceAll(key,"[REDACTED]"));
    } catch (e) {
      if ((e as Error).message?.startsWith("2Captcha")) throw e;
      // network blip — retry
    }
  }
  throw new Error(`2captcha timed out after ${timeoutMs}ms (task ${taskId})`);
}

async function solve2Captcha(
  type: CaptchaSolveType,
  siteKey: string,
  pageUrl: string,
  action: string | undefined,
  minScore: number | undefined,
  imageBase64: string | undefined,
  timeoutMs: number,
  pollMs: number
): Promise<string> {
  const key = captchaKey();
  if (!key) throw new Error("AGENT_CAPTCHA_KEY is not set");
  const taskId = await submit2Captcha(key, type, siteKey, pageUrl, action, minScore, imageBase64);
  // Provider guidance: wait at least five seconds between result requests.
  return poll2Captcha(key, taskId, timeoutMs, Math.max(5000, pollMs));
}

// ─── CapSolver ─────────────────────────────────────────────────────────────────

async function solveCapsolver(
  type: CaptchaSolveType,
  siteKey: string,
  pageUrl: string,
  action: string | undefined,
  minScore: number | undefined,
  timeoutMs: number,
  pollMs: number
): Promise<string> {
  const key = captchaKey();
  if (!key) throw new Error("AGENT_CAPTCHA_KEY is not set");

  let taskType: string;
  const taskBody: Record<string, unknown> = { websiteURL: pageUrl, websiteKey: siteKey };

  if (type === "recaptcha_v2") {
    taskType = "ReCaptchaV2TaskProxyLess";
  } else if (type === "recaptcha_v3") {
    taskType = "ReCaptchaV3TaskProxyLess";
    taskBody["pageAction"] = action ?? "verify";
    taskBody["minScore"] = minScore ?? 0.7;
  } else if (type === "hcaptcha") {
    taskType = "HCaptchaTaskProxyLess";
  } else if (type === "turnstile") {
    taskType = "AntiTurnstileTaskProxyLess";
  } else {
    throw new Error(`CapSolver does not support type "${type}" — use 2captcha for image CAPTCHAs`);
  }

  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: key, task: { type: taskType, ...taskBody } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!createRes.ok) throw new Error(`CapSolver createTask HTTP ${createRes.status}`);
  const createData = (await createRes.json()) as {
    errorId: number;
    errorCode?: string;
    taskId?: string;
  };
  if (createData.errorId !== 0) throw new Error(`CapSolver createTask error: ${createData.errorCode}`);
  const taskId = createData.taskId;
  if (!taskId) throw new Error("CapSolver returned no taskId");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollMs));
    try {
      const pollRes = await fetch("https://api.capsolver.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!pollRes.ok) continue;
      const data = (await pollRes.json()) as {
        errorId: number;
        errorCode?: string;
        status: string;
        solution?: { gRecaptchaResponse?: string; token?: string; userAgent?: string };
      };
      if (data.errorId !== 0) throw new Error(`CapSolver poll error: ${data.errorCode}`);
      if (data.status === "ready" && data.solution) {
        return data.solution.gRecaptchaResponse ?? data.solution.token ?? "";
      }
    } catch (e) {
      if ((e as Error).message?.startsWith("CapSolver")) throw e;
    }
  }
  throw new Error(`CapSolver timed out after ${timeoutMs}ms (task ${taskId})`);
}

// ─── Tool ──────────────────────────────────────────────────────────────────────

export const captchaSolveTool = defineTool({
  name: "captcha_solve",
  description:
    "WHAT: Solve a CAPTCHA (reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, image) via 2captcha or CapSolver; type=coordinates uses 2Captcha for custom visual puzzles without site keys.\n" +
    "WHEN: an actual interactive CAPTCHA needs completion. A background script or badge is not evidence that signup is blocked.\n" +
    "HOW: Pass type + site_key + page_url, or pass session_id and the tool auto-detects. " +
    "Set auto_inject:true to write the token directly into the page DOM.\n" +
    "For a visual puzzle use native screenshots + browser_act drag_at, or type=coordinates with region {x,y,width,height} and instructions for ordered points (e.g. source centre then matching destination). The backend captures the crop; never pass screenshot base64 through context. Coordinates are returned in viewport CSS pixels.\n" +
    "For canvas drag puzzles use captcha_inspect then captcha_drag. CoordinatesTask recognises points; it is not a puzzle type and does not move or submit anything.\n" +
    "Env: AGENT_CAPTCHA_KEY (API key), AGENT_CAPTCHA_SERVICE (2captcha|capsolver, default 2captcha).",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["recaptcha_v2", "recaptcha_v3", "hcaptcha", "turnstile", "image", "coordinates"],
        description: "CAPTCHA type. Omit when session_id provided — auto-detected from DOM.",
      },
      site_key: {
        type: "string",
        description: "CAPTCHA site key (data-sitekey). Omit when session_id provided — auto-detected.",
      },
      page_url: {
        type: "string",
        description: "Page URL where CAPTCHA is shown. Omit when session_id provided — read from session.",
      },
      session_id: {
        type: "string",
        description: "Observed tab ID, or omit/use current for this chat's selected tab. Enables detection and injection in the same browser session.",
      },
      auto_inject: {
        type: "boolean",
        description: "When true and session_id provided, inject solved token into page DOM automatically (default true).",
      },
      action: {
        type: "string",
        description: "reCAPTCHA v3 action string (default 'verify').",
      },
      min_score: {
        type: "number",
        description: "reCAPTCHA v3 minimum score 0.0–1.0 (default 0.7).",
      },
      image_base64: {
        type: "string",
        description: "Base64-encoded image for type=image CAPTCHAs.",
      },
      region:{type:'object',properties:{x:{type:'number',minimum:0},y:{type:'number',minimum:0},width:{type:'number',minimum:10,maximum:1000},height:{type:'number',minimum:10,maximum:1000}},required:['x','y','width','height'],additionalProperties:false},
      instructions:{type:'string',description:'For coordinates: what to mark, in order; describe source and destination for a drag.',maxLength:500},
      min_clicks:{type:'integer',minimum:1,maximum:10},max_clicks:{type:'integer',minimum:1,maximum:10},
      service: {
        type: "string",
        enum: ["2captcha", "capsolver"],
        description: "Override AGENT_CAPTCHA_SERVICE for this call.",
      },
    },
    additionalProperties: false,
  },
  handler: async (args, emit, harness,context) => {
    const key = captchaKey();
    if (!key && args.type!=='inspect') {
      return {
        ok: false,
        error: "AGENT_CAPTCHA_KEY is not set. Add it to .env (2captcha or CapSolver API key).",
      };
    }

    let sessionId = (args["session_id"] as string | undefined)?.trim() || undefined;
    if (harness && (!sessionId || isCurrentBrowserTabHandle(sessionId))) {
      const state = browserWorkspaceState(harness.taskId);
      const tabs = state.tabs.filter(tab => tab.ownerTaskId === harness.taskId);
      sessionId = state.selectedTabId ?? (tabs.length === 1 ? tabs[0]!.sessionId : undefined);
      if (!sessionId && tabs.length > 1) return {ok:false,error:"Multiple task tabs are open. Pass the intended session_id from browser_tabs. No paid task submitted."};
    }
    if (sessionId && harness) {
      const matches = browserWorkspaceState().tabs.filter(tab => tab.sessionId === sessionId ||
        "tab-" + tab.sessionId.replace(/[^a-z0-9]/gi, "").slice(0,8) === sessionId);
      if (matches.length !== 1) return {ok:false,error:"Unknown browser tab. Use browser_tabs to select this chat's tab. No paid task submitted."};
      sessionId = matches[0]!.sessionId;
    }
    if (sessionId && harness) { const error = checkBrowserSessionOwner(sessionId, harness.taskId); if (error) return {ok: false, error}; }
    if (sessionId) { const active = await ensureBrowserSessionActive(sessionId); if (!active.ok) return active; }
    if(sessionId&&harness)selectBrowserTaskTab(harness.taskId,sessionId);
    const autoInject = args["auto_inject"] !== false;
    const svc: CaptchaService =
      (args["service"] as CaptchaService | undefined) ?? captchaService();
    const timeoutMs = captchaTimeoutMs();
    const pollMs = captchaPollMs();
    if(args.type==='inspect'){
      if(!sessionId)return {ok:false,error:'Inspect requires a browser tab from this chat.'};
      try{
        const inspection=await inspectBrowserVisualTargets(sessionId);
        const widget=await detectCaptchaInBrowserSession(sessionId);
        const submission=await readCaptchaSubmissionState(sessionId);
        const supportedWidget=widget?.presentation==='visible_widget'&&!!widget.siteKey;
        const solver={configured:!!key,service:svc,token_solve_available:supportedWidget&&!!key,...(supportedWidget&&key?{tool:'captcha_solve',arguments:{session_id:'current'}}:{})};
        if(typeof args.visual_ref==='string'&&!inspection.targets.some(t=>t.ref===args.visual_ref))return {ok:false,error:'Unknown visual ref in the current visible canvases. Use captcha_inspect without visual_ref for the current page. No paid task submitted.'};
        const target=inspection.targets.find(t=>t.ref===args.visual_ref)??(inspection.targets.length===1?inspection.targets[0]:undefined);
        if(target&&harness){
          const source=await browserVisualTarget(sessionId,target.ref),image=await captureCaptchaRegion(source.page,source.box);
          invalidateBrowserImage(harness,sessionId);
          const queued=await attachNativeImage(harness,'data:image/jpeg;base64,'+image.body,`Focused canvas ${target.ref}: ${source.box.width} × ${source.box.height} pixels. source_region uses THIS image's coordinates, with (0,0) at this image's top-left. The surrounding webpage is not part of this image.`, 'browser:'+sessionId);
          if(!queued.ok)return queued;
        }
        return {ok:true,output:JSON.stringify({status:supportedWidget?'supported_widget':inspection.targets.length?'visual_inspection':'no_visible_canvas',challenge_kind:supportedWidget?widget!.type:'unclassified',solver,submission,paid_task_submitted:false,visual_targets:inspection.targets,focused_ref:target?.ref,...(target?{source_region_coordinate_space:'canvas_image_pixels'}:{}),next:submission.response_present&&submission.enabled_submit_controls.length?'A verification response is already present and the form has an enabled submit control. Submit the existing form and read its response before paying for another solve. If covered, dismiss the challenge overlay with Escape; an unchecked graphic alone does not establish rejection.':supportedWidget?(key?'A supported visible token widget and configured solver are available. captcha_solve can handle this existing tab; inspect the resulting page before submitting the form.':'A supported widget is visible but no solver key is configured. No paid task was submitted.'):target?'Read the page instructions and focused image to identify the task. Only a loose-piece drag puzzle uses captcha_drag. This inspection does not classify the challenge.':inspection.targets.length?'Choose an observed visual_ref to focus the intended canvas.':'No visible canvas was observed. Read the current page feedback and instructions; do not assume a drag puzzle.'})+'\n'+inspection.snapshot};
      }catch(error){return {ok:false,error:error instanceof Error?error.message:'Visual inspection failed'};}
    }
    if(args.type==='visual_drag'){
      if(svc!=='2captcha')return {ok:false,error:'visual_drag requires 2captcha; no paid task submitted.'};
      if(!sessionId||typeof args.visual_ref!=='string')return {ok:false,error:'visual_drag requires the current canvas visual_ref from inspect. No paid task submitted.'};
      try{
        const target=await browserVisualTarget(sessionId,args.visual_ref);
        emit?.('\ncaptcha_solve: matching the separate source piece to one destination on the observed canvas…\n');
        const solved=await solveVisualDrag({page:target.page,box:target.box,source:args.source_region,key,timeoutMs,pollMs:Math.max(5000,pollMs),signal:context?.signal,autoApply:args.auto_apply!==false});
        const observed=await snapshotBrowserSession(sessionId,false);
        if(!observed.ok)return {ok:false,error:'Drag completed, but observing the result failed. Do not repeat the drag; refresh the page observation. '+observed.error};
        return attachBrowserImage(harness,'browser_act',{ok:true,output:JSON.stringify({status:solved.applied?'visual_drag_applied':'visual_drag_planned',...solved,next:solved.applied?'The pointer drag completed. Acceptance has NOT been assessed. Submit the observed Next/Verify button if present, then read the site response before deciding success, retry, or another round. Do not solve the moved piece again before submission.':'No gesture performed.'})+'\n'+observed.output});
      }catch(error){return {ok:false,error:(error instanceof Error?error.message:'Visual drag failed').replaceAll(key,'[REDACTED]')};}
    }
    if(args.type==='coordinates'){
      if(svc!=='2captcha')return {ok:false,error:'Coordinate tasks require 2captcha. No paid task submitted.'};
      const page=sessionId?getBrowserSession(sessionId)?.page:undefined;
      if(!page)return {ok:false,error:'coordinates requires this chat’s live session. No paid task submitted.'};
      try{
        const image=await captureCaptchaRegion(page,args.region);
        emit?.('\ncaptcha_solve: submitting cropped visual challenge via 2Captcha CoordinatesTask…\n');
        const solved=await solveCoordinateImage({key,body:image.body,instructions:String(args.instructions??''),minClicks:Number(args.min_clicks??1),maxClicks:Number(args.max_clicks??5),timeoutMs,pollMs:Math.max(5000,pollMs),signal:context?.signal});
        if(solved.points.some(p=>p.x>=image.region.width||p.y>=image.region.height))return {ok:false,error:'Solver coordinates lie outside the submitted image. No browser action performed.'};
        const current=await captureCaptchaRegion(page,image.region);
        if(current.url!==image.url||current.hash!==image.hash)return {ok:false,error:'VISUAL_CHALLENGE_CHANGED: the page or challenge changed while the service solved it. No action performed; inspect the current page before another paid attempt.'};
        return {ok:true,output:JSON.stringify({status:'coordinate_solution_received',service:'2captcha',coordinate_space:'viewport_css_pixels',points:solved.points.map(p=>({x:image.region.x+p.x,y:image.region.y+p.y})),region:image.region,cost:solved.cost,verification_state:'not_applied',next:'These are recognised coordinates only. Use browser_act click_at or drag_at, submit if required, then read the site response. No token was injected.'})};
      }catch(error){return {ok:false,error:(error instanceof Error?error.message:'Coordinate task failed').replaceAll(key,'[REDACTED]')};}
    }

    // Auto-detect from session when session_id provided
    let resolvedType = (args["type"] as CaptchaSolveType | undefined) ?? undefined;
    let resolvedSiteKey = (args["site_key"] as string | undefined)?.trim() || undefined;
    let resolvedPageUrl = (args["page_url"] as string | undefined)?.trim() || undefined;

    // If session_id given and fields missing, detect from DOM
    if (sessionId && (!resolvedType || !resolvedSiteKey || !resolvedPageUrl)) {
      emit?.("\ncaptcha_solve: auto-detecting CAPTCHA from browser session…\n");
      try {
        const detected = await detectCaptchaInBrowserSession(sessionId);
        if (!detected) {
          const page=getBrowserSession(sessionId)?.page;
          const snapshot=page?await buildPageSnapshot(page):undefined;
          if(snapshot&&/human verification|captcha|drag[^\n]{0,60}puzzle|align[^\n]{0,40}rectangles/i.test(snapshot.snapshotText))return {ok:false,error:'VISIBLE_VISUAL_CHALLENGE: no supported site-key/token widget detected. Use captcha_inspect to observe the actual canvas and its instructions. Use captcha_drag only when the page asks for a drag puzzle. Native browser input remains available. No paid task submitted.'};
          return { ok: false, error: "No supported token CAPTCHA detected. Inspect the page; visual challenges can use screenshots with drag_at or type=coordinates. No paid task submitted." };
        }
        if (detected.presentation === "background" && !args["type"]) {
          return {ok:false,error:"Only a background verification integration was observed. No paid task submitted. Continue the form; explicitly select an invisible CAPTCHA type only when required."};
        }
        resolvedType = resolvedType ?? detected.type;
        resolvedSiteKey = resolvedSiteKey ?? detected.siteKey ?? undefined;
        resolvedPageUrl = resolvedPageUrl ?? detected.pageUrl;
        emit?.(`  → detected type=${resolvedType}, site_key=${resolvedSiteKey ?? "(none)"}\n`);
      } catch (e) {
        return { ok: false, error: `Auto-detect failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    if (!resolvedType) return { ok: false, error: "type is required (or provide session_id for auto-detect)" };
    if (resolvedType !== "image" && !resolvedSiteKey) {
      return { ok: false, error: "site_key is required for this CAPTCHA type (or provide session_id for auto-detect)" };
    }
    if (!resolvedPageUrl) return { ok: false, error: "page_url is required (or provide session_id for auto-detect)" };

    emit?.(`\ncaptcha_solve: submitting ${resolvedType} via ${svc}…\n`);

    let token: string;
    try {
      if (svc === "capsolver") {
        token = await solveCapsolver(
          resolvedType,
          resolvedSiteKey ?? "",
          resolvedPageUrl,
          args["action"] as string | undefined,
          args["min_score"] as number | undefined,
          timeoutMs,
          pollMs
        );
      } else {
        token = await solve2Captcha(
          resolvedType,
          resolvedSiteKey ?? "",
          resolvedPageUrl,
          args["action"] as string | undefined,
          args["min_score"] as number | undefined,
          args["image_base64"] as string | undefined,
          timeoutMs,
          pollMs
        );
      }
    } catch (err) {
      return { ok: false, error: (err instanceof Error ? err.message : String(err)).replaceAll(key,"[REDACTED]") };
    }

    if (!token.trim()) return {ok:false,error:"Solver returned an empty solution; no token injected."};
    emit?.(`  → solved! token length: ${token.length}\n`);

    let injectResult = "";
    if (sessionId && autoInject && resolvedType !== "image") {
      const injected = await injectCaptchaToken(sessionId, resolvedType as CaptchaType, token);
      if (!injected.ok) return {ok:false,error:"Solver returned a solution, but applying it to the existing tab failed. Do not submit another paid task blindly. " + injected.error};
      injectResult = `\n${injected.output}\n→ Continue the existing form from its observed state.`;
      const observed=await snapshotBrowserSession(sessionId,false);
      if(observed.ok)injectResult+='\nCURRENT_PAGE_AFTER_SOLUTION:\n'+observed.output;
      await attachBrowserImage(harness,'browser_snapshot',observed);
    }

    return {
      ok: true,
      output:
        `CAPTCHA_SOLUTION_RECEIVED\nservice=${svc}\ntype=${resolvedType}\n${sessionId && autoInject && resolvedType !== "image" ? "token=stored_in_page" : "token=" + token}${injectResult}\nRead the site's response after submitting to establish acceptance.`,
    };
  },
});

// Keep solving and token application in the task's existing serialized browser flow.
const captchaHandler = captchaSolveTool.handler;
captchaSolveTool.handler = (args, emit, harness, context) =>
  withBrowserTask(harness?.taskId ?? "anonymous", () => captchaHandler(args, emit, harness, context));

// Separate schemas prevent missing mode/unknown fields from silently falling back
// to token detection. Internal legacy modes remain for persisted procedures.
export const captchaInspectTool=defineTool({
 name:'captcha_inspect',
 description:'Inspect visible verification widgets and canvases without a paid solve. Reports configured solver availability for supported widgets. Returns observed visual_ref, a focused image and page instructions. Does not classify the puzzle. Use captcha_drag only for a loose-piece drag puzzle; source_region then uses this image’s pixels.',
 requiresApproval:false,
 parameters:{type:'object',properties:{session_id:{type:'string'},visual_ref:{type:'string',description:'Optional observed canvas ref when more than one canvas is visible.'}},additionalProperties:false},
 handler:(args,emit,harness,context)=>captchaSolveTool.handler({...args,type:'inspect'},emit,harness,context),
});
export const captchaDragTool=defineTool({
 name:'captcha_drag',
 description:'Solve a loose-piece drag puzzle observed with captcha_inspect. Sends the loose piece separately to 2Captcha, recognises one matching destination, and applies the exact native drag. Requires visual_ref and source_region in focused-image pixels. Returns pending_submission: then click the observed Next/Verify button and read the response. Does not handle click grids, coordinate questions or press-and-hold challenges.',
 requiresApproval:true,dangerLevel:'cautious',
 parameters:{type:'object',properties:{session_id:{type:'string'},visual_ref:{type:'string',description:'Observed e-number for the canvas from captcha_inspect.'},source_region:{type:'object',description:'Bounds of the loose piece in the focused canvas image, with (0,0) at its top-left. Not viewport coordinates.',properties:{x:{type:'number',minimum:0},y:{type:'number',minimum:0},width:{type:'number',minimum:10,maximum:250},height:{type:'number',minimum:10,maximum:250}},required:['x','y','width','height'],additionalProperties:false}},required:['visual_ref','source_region'],additionalProperties:false},
 handler:(args,emit,harness,context)=>captchaSolveTool.handler({...args,type:'visual_drag',service:'2captcha',auto_apply:true},emit,harness,context),
});

