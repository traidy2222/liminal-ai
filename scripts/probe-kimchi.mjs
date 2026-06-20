#!/usr/bin/env node
/** Probe Cast AI / Kimchi — non-stream + stream, cast.ai vs kimchi.dev. */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const key = process.env.KIMCHI_API_KEY?.trim() || process.env.CASTAI_API_KEY?.trim();
if (!key) {
  console.error("No KIMCHI_API_KEY in .env");
  process.exit(1);
}

const BASES = [
  "https://llm.cast.ai/openai/v1",
  "https://llm.kimchi.dev/openai/v1",
];
const MODEL = process.argv[2]?.trim() || "minimax-m2.7";

async function probe(base, stream) {
  const t0 = Date.now();
  const label = `${base.replace("https://", "")} stream=${stream}`;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Say pong" }],
        max_tokens: 8,
        temperature: 0,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.log(`FAIL ${label} ${Date.now() - t0}ms — HTTP ${res.status}: ${text.slice(0, 200)}`);
      return;
    }
    if (!stream) {
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content ?? "";
      console.log(`OK   ${label} ${Date.now() - t0}ms — "${String(content).trim().slice(0, 40)}"`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let chunks = 0;
    let bytes = 0;
    let ttft = null;
    const dec = new TextDecoder();
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      bytes += value?.length ?? 0;
      body += dec.decode(value, { stream: true });
      if (ttft === null) ttft = Date.now() - t0;
    }
    const errInStream = /"error"|exhausted|credits/i.test(body);
    console.log(
      `${errInStream ? "WARN" : "OK  "} ${label} ${Date.now() - t0}ms — chunks=${chunks} bytes=${bytes} ttft=${ttft ?? "?"}ms`
    );
    if (errInStream || chunks <= 2) console.log(`  body: ${body.trim().slice(0, 300)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FAIL ${label} ${Date.now() - t0}ms — ${msg.slice(0, 160)}`);
  }
}

async function listModels(base) {
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json();
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean);
    const has = ids.includes(MODEL);
    console.log(
      `models ${base.replace("https://", "")} — HTTP ${res.status}, count=${ids.length}, has ${MODEL}=${has}`
    );
    if (!has && ids.length) console.log(`  sample: ${ids.slice(0, 8).join(", ")}`);
  } catch (e) {
    console.log(`models ${base} — ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`Probing Kimchi model=${MODEL}\n`);
for (const base of BASES) await listModels(base);
console.log("");
for (const base of BASES) {
  await probe(base, false);
  await probe(base, true);
}
