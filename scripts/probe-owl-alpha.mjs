/**
 * Probe openrouter/owl-alpha (Stealth) — minimal vs tools vs cache_control.
 * Usage: node scripts/probe-owl-alpha.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function loadKey() {
  for (const p of [join(process.cwd(), ".env"), join(homedir(), ".liminal", ".env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^AGENT_API_KEY=(.+)$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return process.env.AGENT_API_KEY?.trim();
}

const key = loadKey();
if (!key) {
  console.error("No AGENT_API_KEY in .env or ~/.liminal/.env");
  process.exit(1);
}

const base = "https://openrouter.ai/api/v1";
const model = "openrouter/owl-alpha";
const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://liminal.local",
  "X-Title": "liminal-probe",
};

async function getModelMeta() {
  const res = await fetch(`${base}/models`, { headers: { Authorization: headers.Authorization } });
  const data = await res.json();
  const m = data.data?.find((x) => x.id === model);
  console.log("=== model meta ===");
  console.log(JSON.stringify(m ?? { error: "not found" }, null, 2).slice(0, 2000));
}

async function call(label, body) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n=== ${label} status ${res.status} ===`);
  console.log(text.slice(0, 800));
}

await getModelMeta();

await call("minimal-stealth", {
  model,
  messages: [{ role: "user", content: "Say hi in 3 words" }],
  max_tokens: 20,
  provider: { order: ["Stealth"], allow_fallbacks: true },
});

await call("minimal-no-pin", {
  model,
  messages: [{ role: "user", content: "Say hi in 3 words" }],
  max_tokens: 20,
});

await call("one-tool", {
  model,
  messages: [{ role: "user", content: "Use think then answer: what is 2+2?" }],
  tools: [
    {
      type: "function",
      function: {
        name: "think",
        description: "Private reasoning",
        parameters: {
          type: "object",
          properties: { thought: { type: "string" } },
          required: ["thought"],
        },
      },
    },
  ],
  tool_choice: "auto",
  max_tokens: 200,
  provider: { order: ["Stealth"], allow_fallbacks: true },
});

await call("cache-control", {
  model,
  messages: [
    {
      role: "system",
      content: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
    },
    { role: "user", content: "hi" },
  ],
  max_tokens: 20,
  provider: { order: ["Stealth"], allow_fallbacks: true },
});

const epRes = await fetch(`${base}/models/openrouter/owl-alpha/endpoints`, {
  headers: { Authorization: headers.Authorization },
});
console.log("\n=== endpoints ===");
console.log((await epRes.text()).slice(0, 2000));

await call("debug-minimal", {
  model,
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 10,
  provider: { order: ["Stealth"], allow_fallbacks: true },
  debug: { echo_upstream_body: true },
});

const freeCandidates = [
  "openrouter/free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "deepseek/deepseek-v4-flash",
];
for (const alt of freeCandidates) {
  await call(`compare-${alt}`, {
    model: alt,
    messages: [{ role: "user", content: "Say ok" }],
    max_tokens: 10,
  });
}

await call("stream-tools", {
  model,
  stream: true,
  messages: [{ role: "user", content: "hello" }],
  tools: [
    {
      type: "function",
      function: {
        name: "think",
        description: "think",
        parameters: { type: "object", properties: { thought: { type: "string" } }, required: ["thought"] },
      },
    },
  ],
  tool_choice: "auto",
  max_tokens: 100,
  stream_options: { include_usage: true },
  provider: { order: ["Stealth"], allow_fallbacks: true },
});
