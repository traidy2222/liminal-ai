/**
 * captcha_solve — resolves reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs
 * via 2captcha or CapSolver. Optionally auto-detects the site key from a live browser session
 * and injects the solved token directly into the DOM.
 *
 * Env: AGENT_CAPTCHA_KEY (secret), AGENT_CAPTCHA_SERVICE (2captcha|capsolver, default 2captcha),
 *      AGENT_CAPTCHA_TIMEOUT_MS (default 120000), AGENT_CAPTCHA_POLL_MS (default 3000).
 */
import { defineTool } from "./helpers.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import {
  injectCaptchaToken,
  detectCaptchaInBrowserSession,
  type CaptchaType,
} from "./browser_runtime.js";

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

  const submitRes = await fetch("http://2captcha.com/in.php", {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(30_000),
  });
  if (!submitRes.ok) throw new Error(`2captcha submit HTTP ${submitRes.status}`);
  const submitData = (await submitRes.json()) as { status: number; request: string };
  if (submitData.status !== 1) throw new Error(`2captcha submit error: ${submitData.request}`);
  return submitData.request; // task ID
}

async function poll2Captcha(key: string, taskId: string, timeoutMs: number, pollMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollMs));
    try {
      const res = await fetch(
        `http://2captcha.com/res.php?key=${encodeURIComponent(key)}&action=get&id=${encodeURIComponent(taskId)}&json=1`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { status: number; request: string };
      if (data.status === 1) return data.request;
      if (data.request === "ERROR_CAPTCHA_UNSOLVABLE") throw new Error("CAPTCHA marked unsolvable by 2captcha");
      if (data.request !== "CAPCHA_NOT_READY") {
        // Transient error — keep polling
        continue;
      }
    } catch (e) {
      if ((e as Error).message?.includes("unsolvable")) throw e;
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
  return poll2Captcha(key, taskId, timeoutMs, pollMs);
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
    "WHAT: Solve a CAPTCHA (reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, image) via 2captcha or CapSolver.\n" +
    "WHEN: browser_open or browser_snapshot shows [CAPTCHA DETECTED]. Solve, then browser_act to submit.\n" +
    "HOW: Pass type + site_key + page_url, or pass session_id and the tool auto-detects. " +
    "Set auto_inject:true to write the token directly into the page DOM.\n" +
    "Env: AGENT_CAPTCHA_KEY (API key), AGENT_CAPTCHA_SERVICE (2captcha|capsolver, default 2captcha).",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["recaptcha_v2", "recaptcha_v3", "hcaptcha", "turnstile", "image"],
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
        description: "Existing browser session — enables auto-detection of type/site_key/page_url and auto_inject.",
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
      service: {
        type: "string",
        enum: ["2captcha", "capsolver"],
        description: "Override AGENT_CAPTCHA_SERVICE for this call.",
      },
    },
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const key = captchaKey();
    if (!key) {
      return {
        ok: false,
        error: "AGENT_CAPTCHA_KEY is not set. Add it to .env (2captcha or CapSolver API key).",
      };
    }

    const sessionId = (args["session_id"] as string | undefined)?.trim() || undefined;
    const autoInject = args["auto_inject"] !== false;
    const svc: CaptchaService =
      (args["service"] as CaptchaService | undefined) ?? captchaService();
    const timeoutMs = captchaTimeoutMs();
    const pollMs = captchaPollMs();

    // Auto-detect from session when session_id provided
    let resolvedType = (args["type"] as CaptchaSolveType | undefined) ?? undefined;
    let resolvedSiteKey = (args["site_key"] as string | undefined)?.trim() || undefined;
    let resolvedPageUrl = (args["page_url"] as string | undefined)?.trim() || undefined;

    if (sessionId) {
      const { detectCaptchaSignals: _detect } = await import("./browser_runtime.js");
      // We already imported detectCaptchaSignals at the top; use via the session
      // The session lookup is internal — we call the exported detect function via browser_runtime
    }

    // If session_id given and fields missing, detect from DOM
    if (sessionId && (!resolvedType || !resolvedSiteKey || !resolvedPageUrl)) {
      emit?.("\ncaptcha_solve: auto-detecting CAPTCHA from browser session…\n");
      try {
        const detected = await detectCaptchaInBrowserSession(sessionId);
        if (!detected) {
          return { ok: false, error: "No CAPTCHA detected in session. Verify the page has a CAPTCHA widget visible." };
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    emit?.(`  → solved! token length: ${token.length}\n`);

    let injectResult = "";
    if (sessionId && autoInject && resolvedType !== "image") {
      const injected = await injectCaptchaToken(sessionId, resolvedType as CaptchaType, token);
      injectResult = injected.ok
        ? `\n${injected.output}\n→ Next: browser_act to click the submit button.`
        : `\nToken injection failed: ${injected.error}\n→ Inject manually: set [name="g-recaptcha-response"] value to the token.`;
    }

    return {
      ok: true,
      output:
        `CAPTCHA_SOLVED\nservice=${svc}\ntype=${resolvedType}\ntoken=${token}${injectResult}`,
    };
  },
});

