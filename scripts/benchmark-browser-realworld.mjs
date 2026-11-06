// Manual live evaluation of the installed Liminal desktop harness. It uses the configured model and public websites.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const phase = process.argv[2] || "manual",
  filter = process.argv.slice(3);
if (!/^[a-zA-Z0-9_-]+$/.test(phase))
  throw Error(
    "Run name must contain only letters, digits, underscores or hyphens",
  );
const root = path.resolve(".agent_artifacts/real-world-browser", phase);
fs.mkdirSync(root, { recursive: true });
const handshakePath = path.join(os.homedir(), ".liminal/sidecar.json");
let h;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    h = JSON.parse(fs.readFileSync(handshakePath));
    if (h.port && h.token) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!h?.port || !h?.token)
  throw Error(
    "Liminal sidecar is not ready. Launch the desktop app and retry.",
  );
const oraclePath = path.resolve(
  ".agent_artifacts/real-world-browser/oracles.json",
);
if (!fs.existsSync(oraclePath)) {
  const release = await fetch(
    "https://api.github.com/repos/microsoft/playwright/releases/latest",
    {
      headers: { "User-Agent": "Liminal-browser-benchmark" },
      signal: AbortSignal.timeout(20000),
    },
  ).then((r) => r.json());
  const checksum = await fetch(
    "https://nodejs.org/dist/v24.11.0/SHASUMS256.txt",
    { signal: AbortSignal.timeout(20000) },
  ).then((r) => r.text());
  fs.writeFileSync(
    oraclePath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        release: {
          tag: release.tag_name,
          published: release.published_at,
          html_url: release.html_url,
          body: release.body,
        },
        checksum: { text: checksum },
      },
      null,
      2,
    ),
  );
}
const oracle = JSON.parse(fs.readFileSync(oraclePath));
async function nativePort() {
  if (process.env.LIMINAL_BENCH_CDP_PORT)
    return Number(process.env.LIMINAL_BENCH_CDP_PORT);
  if (process.platform !== "win32")
    throw Error("Set LIMINAL_BENCH_CDP_PORT to the desktop browser CDP port.");
  const command =
    "Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | ForEach-Object { if ($_.CommandLine -like '*Liminal*Browser*' -and $_.CommandLine -match '--remote-debugging-port=(\\d+)') { $Matches[1] } } | Select-Object -Unique";
  let ports = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    ports = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true },
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ports.length === 1 && /^\d+$/.test(ports[0])) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (ports.length !== 1 || !/^\d+$/.test(ports[0]))
    throw Error(
      "Launch the Liminal desktop browser, or set LIMINAL_BENCH_CDP_PORT.",
    );
  return Number(ports[0]);
}
const cdpPort = await nativePort();
const client = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
const ws = new WebSocket(
  `ws://127.0.0.1:${h.port}?token=${encodeURIComponent(h.token)}`,
);
const pending = new Map();
let active;
const control = async (action, sessionId) => {
  const r = await fetch(`http://127.0.0.1:${h.port}/browser/control`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${h.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, sessionId }),
  });
  return r.json();
};
const cmd = (command, data = {}) =>
  new Promise((resolve, reject) => {
    const id = crypto.randomUUID(),
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Command timeout"));
      }, 25000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ v: 1, t: "cmd", id, command, data }));
  });
const ready = new Promise((resolve, reject) => {
  ws.on("error", reject);
  ws.on("message", (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.event === "sidecar_ready") resolve();
    if (f.event === "command_result") {
      const p = pending.get(f.data.commandId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(f.data.commandId);
        f.data.ok ? p.resolve(f.data.data) : p.reject(Error("Command failed"));
      }
    }
    if (!active || f.chatId !== active.chatId) return;
    const data = f.data || {};
    if (f.event === "tool_start" && !active.firstActionAt)
      active.firstActionAt = Date.now();
    if (f.event === "text" && data.channel === "user") {
      if (!active.firstTextAt) active.firstTextAt = Date.now();
      active.reply += data.delta || data.text || "";
    }
    if (f.event === "text" && data.channel === "trace") {
      const m = (data.delta || "").match(/cached=(\d+)\/(\d+)/);
      if (m) active.usage.push({ cached: Number(m[1]), input: Number(m[2]) });
    }
    if (f.event === "tool_result") {
      const result = data.result || {},
        row = {
          tool: data.name,
          args: data.args,
          ok: result.ok,
          error: result.error,
          output: result.output,
          at: Date.now(),
        };
      active.trace.push(row);
      for (const m of String(result.output || "").matchAll(
        /SESSION_ID:\s+(\S+)/g,
      )) {
        active.handles.add(m[1]);
        if (data.name === "browser_open") active.createdHandles.add(m[1]);
      }
      console.log(
        JSON.stringify({
          task: active.id,
          tool: data.name,
          ok: result.ok,
          error: result.error?.split("\n")[0]?.slice(0, 160),
        }),
      );
    }
    if (f.event === "ask_user" || f.event === "approval_request") {
      active.questions += f.event === "ask_user";
      active.approvals += f.event === "approval_request";
      active.interruption = {
        event: f.event,
        prompt: data.prompt || data.question || data.name,
      };
      cmd("abort", { chatId: active.chatId }).catch(() => {});
    }
    if (f.event === "turn_end") {
      active.termination = data.harnessMetrics?.terminationReason;
      active.resolve();
    }
  });
});
const prefix = `Liminal ${phase} ${Date.now().toString(36)}`;
const tomorrow = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Australia/Brisbane",
  dateStyle: "full",
}).format(new Date(Date.now() + 86400000));
const scenarios = [
  {
    id: "releases",
    url: "https://github.com/microsoft/playwright/releases",
    prompt:
      "On GitHub, find the newest stable Microsoft Playwright release. Give its version, publication date, and two concrete fixes or changes from its release notes. Distinguish stable releases from prereleases.",
  },
  {
    id: "documentation",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
    prompt:
      "Use the MDN Fetch documentation to answer: does fetch reject automatically on HTTP 404, how do I detect that response, and how do I cancel an in-flight request? Give a short example and link to the relevant documentation sections.",
  },
  {
    id: "shopping",
    url: "https://www.jbhifi.com.au/collections/computer-parts-accessories/wireless-mice",
    prompt:
      "Find the Logitech M185 Wireless Mouse (Blue) and M240 Silent Bluetooth Mouse (Graphite) on JB Hi-Fi Australia. Compare their current prices, wireless connection type and listed warranty length, link each product, and say which is cheaper. Do not add to cart or purchase.",
  },
  {
    id: "weather",
    url: "https://www.bom.gov.au/qld/forecasts/brisbane.shtml",
    prompt:
      `Use the Bureau of Meteorology website to find the Brisbane city forecast for ${tomorrow}. Report minimum and maximum temperature, chance of rain, and the forecast issue/update time. Use the city forecast, and say clearly if the requested date or issue time is unavailable.`,
  },
  {
    id: "download",
    url: "https://nodejs.org/dist/v24.11.0/",
    prompt:
      "Download the official SHASUMS256.txt for Node.js v24.11.0, save it as node-SHASUMS256.txt in the workspace, and report the SHA256 for node-v24.11.0-x64.msi. Do not download or run an installer.",
  },
  {
    id: "tasklist",
    url: "https://demo.playwright.dev/todomvc/#/",
    prompt: `Use the live TodoMVC task app. Add these three tasks: "${prefix} pack camera", "${prefix} book taxi", "${prefix} draft email". Rename draft email to "${prefix} draft agenda", mark only book taxi completed, use the Completed filter to verify it, then reload and verify the saved state. Preserve any existing tasks and only modify tasks with the exact prefix "${prefix}".`,
  },
];
const results = [];
function grade(c, pages) {
  const reply = c.reply,
    outputs = c.trace
      .filter((t) => t.ok)
      .map((t) => t.output || "")
      .join("\n"),
    evidence = pages.map((p) => p.body).join("\n") + "\n" + outputs;
  if (c.id === "releases") {
    const date = new Date(oracle.release.published),
      day = date.getUTCDate(),
      month = date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      longMonth = date.toLocaleString("en", { month: "long", timeZone: "UTC" });
    const dateMatch =
      reply.includes(oracle.release.published?.slice(0, 10)) ||
      new RegExp(
        `\\b${day}\\s+(?:${month}|${longMonth})\\b|\\b(?:${month}|${longMonth})\\s+${day}\\b`,
        "i",
      ).test(reply);
    return {
      passed:
        reply.includes(oracle.release.tag?.replace(/^v/, "")) &&
        dateMatch &&
        /fix|bug|change/i.test(reply),
      expected: oracle.release.tag,
      date: oracle.release.published?.slice(0, 10),
      sourceAuditRequired: true,
    };
  }
  if (c.id === "documentation")
    return {
      passed:
        /404/.test(reply) &&
        /response\.ok|\.ok|status/.test(reply) &&
        /AbortController/.test(reply) &&
        /abort\(/.test(reply) &&
        /developer.mozilla.org/.test(reply) &&
        /404|AbortController/.test(evidence),
    };
  if (c.id === "shopping")
    return {
      passed:
        /M185/i.test(reply) &&
        /M240/i.test(reply) &&
        /\$\s*\d/.test(reply) &&
        /Bluetooth/i.test(reply) &&
        /receiver|dongle|2\.4/i.test(reply) &&
        /warranty|year/i.test(reply) &&
        /jbhifi.com.au\/products\//.test(reply),
      sourceAuditRequired: true,
    };
  if (c.id === "weather")
    return {
      passed:
        /forecast/i.test(reply) &&
        /\d+\s*\u00b0|\d+\s*degrees/i.test(reply) &&
        /\d+\s*%/.test(reply) &&
        /issued|updated|issue time|update time/i.test(reply) &&
        (pages.some((p) => new URL(p.url).hostname.endsWith("bom.gov.au")) ||
          /bom.gov.au/.test(reply)),
      sourceAuditRequired: true,
    };
  if (c.id === "download") {
    const file = path.join(root, c.id, "node-SHASUMS256.txt");
    const expected = oracle.checksum.text?.match(
      /^([a-f0-9]{64})\s+node-v24\.11\.0-x64\.msi$/m,
    )?.[1];
    const exists = fs.existsSync(file);
    return {
      passed:
        exists &&
        fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") ===
          oracle.checksum.text?.replace(/\r\n/g, "\n") &&
        reply.includes(expected),
      fileExists: exists,
      exactContent:
        exists &&
        fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") ===
          oracle.checksum.text?.replace(/\r\n/g, "\n"),
      checksumReported: !!expected && reply.includes(expected),
    };
  }
  const rawTodos = pages.flatMap((p) =>
    Object.values(p.storage || {}).flatMap((v) => {
      try {
        const a = JSON.parse(v);
        return Array.isArray(a)
          ? a.filter((t) => t.title?.startsWith(prefix))
          : [];
      } catch {
        return [];
      }
    }),
  );
  const todos = [
    ...new Map(rawTodos.map((t) => [t.id || t.title, t])).values(),
  ];
  return {
    passed:
      todos.length === 3 &&
      (pages.some((p) => p.url.includes("/completed")) ||
        c.trace.some((t) => t.output?.includes("/#/completed"))) &&
      todos.some((t) => t.title === prefix + " pack camera" && !t.completed) &&
      todos.some((t) => t.title === prefix + " book taxi" && t.completed) &&
      todos.some((t) => t.title === prefix + " draft agenda" && !t.completed) &&
      !todos.some((t) => t.title === prefix + " draft email"),
    todos: todos.map((t) => ({ title: t.title, completed: t.completed })),
    completedFilter:
      pages.some((p) => p.url.includes("/completed")) ||
      c.trace.some((t) => t.output?.includes("/#/completed")),
  };
}
try {
  await ready;
  for (const spec of scenarios.filter(
    (s) => !filter.length || filter.includes(s.id),
  )) {
    const workspaceRoot = path.join(root, spec.id);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const created = await cmd("create_chat", {
      title: `Browser benchmark: ${phase} ${spec.id}`,
      workspaceRoot,
    });
    const c = {
      id: spec.id,
      chatId: created.chatId,
      reply: "",
      trace: [],
      usage: [],
      questions: 0,
      approvals: 0,
      handles: new Set(),
      createdHandles: new Set(),
      startedAt: Date.now(),
    };
    active = c;
    const ended = new Promise((resolve) => (c.resolve = resolve));
    const timer = setTimeout(() => {
      c.timedOut = true;
      cmd("abort", { chatId: c.chatId }).catch(() => {});
      setTimeout(c.resolve, 5000);
    }, 150000);
    console.log(JSON.stringify({ starting: spec.id, phase }));
    await cmd("send_message", {
      chatId: c.chatId,
      message: `Browser benchmark task. Use Liminal's browser tools for website interaction, not web_fetch, HTTP or shell shortcuts. You may use file tools to save the requested artifact. Start at ${spec.url}\n\n${spec.prompt}\n\nThe workspace is ${workspaceRoot}. Leave the result pages open for inspection. Do not sign in, send messages, post, or purchase anything.`,
    });
    await ended;
    clearTimeout(timer);
    const state = await control("state");
    const owned = state.tabs.filter((tab) => tab.ownerTaskId === c.chatId);
    const pages = [];
    for (const tab of owned) {
      const page = client
        .contexts()
        .flatMap((ctx) => ctx.pages())
        .find((p) => p.url() === tab.url);
      if (!page) continue;
      const body = await page
        .locator("body")
        .innerText({ timeout: 5000 })
        .catch(() => "");
      if (spec.id === "tasklist")
        await page
          .reload({ waitUntil: "domcontentloaded", timeout: 10000 })
          .catch(() => {});
      const storage =
        spec.id === "tasklist"
          ? await page
              .evaluate(() => Object.fromEntries(Object.entries(localStorage)))
              .catch(() => ({}))
          : undefined;
      pages.push({
        url: tab.url,
        title: await page.title().catch(() => ""),
        body: body.slice(0, 80000),
        storage,
      });
      if (spec.id === "shopping" || spec.id === "weather")
        await page
          .screenshot({
            path: path.join(workspaceRoot, `page-${pages.length}.png`),
            fullPage: false,
          })
          .catch(() => {});
    }
    c.pages = pages;
    c.wallMs = Date.now() - c.startedAt;
    c.firstTextMs = c.firstTextAt ? c.firstTextAt - c.startedAt : null;
    c.firstActionMs = c.firstActionAt ? c.firstActionAt - c.startedAt : null;
    c.grade = grade(c, pages);
    c.autonomous =
      c.questions === 0 &&
      c.approvals === 0 &&
      !c.timedOut &&
      c.termination === "ok";
    c.grade.passed = c.grade.passed && c.autonomous;
    c.handles = [...c.handles];
    c.createdHandles = [...c.createdHandles];
    results.push(c);
    fs.writeFileSync(
      path.join(root, "results.json"),
      JSON.stringify(
        {
          phase,
          kind: "installed desktop harness + native WebView2, public live websites",
          prefix,
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        completed: c.id,
        ...c.grade,
        questions: c.questions,
        approvals: c.approvals,
        toolCalls: c.trace.length,
        toolErrors: c.trace.filter((t) => !t.ok).length,
        wallMs: c.wallMs,
        reply: c.reply.slice(-700),
      }),
    );
    for (const tab of owned)
      await control("close", tab.sessionId).catch(() => {});
    active = undefined;
  }
} finally {
  ws.close();
  client.close();
}
