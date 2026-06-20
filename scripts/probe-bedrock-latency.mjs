#!/usr/bin/env node
/** Quick Bedrock latency probe — prints progress immediately, 60s cap per call. */
import OpenAI from "openai";
import {
  resolveManagedOpenRouterCredentials,
  buildManagedInferenceClientHeaders,
} from "../packages/core/src/inference_provider.ts";

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["mistral.ministral-3-3b-instruct", "zai.glm-4.7-flash", "zai.glm-5"];

const CALL_TIMEOUT_MS = 60_000;

async function probe(client, model, headers) {
  const t0 = Date.now();
  process.stdout.write(`  calling ${model}... `);
  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: "Reply with one word: pong" }],
        max_tokens: 8,
        temperature: 0,
      },
      { headers, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }
    );
    const ms = Date.now() - t0;
    const content = res.choices?.[0]?.message?.content?.trim() ?? "";
    const u = res.usage;
    console.log(
      `${ms}ms — "${content.slice(0, 30)}" (prompt=${u?.prompt_tokens ?? "?"} completion=${u?.completion_tokens ?? "?"})`
    );
    return { model, ms, ok: content.length > 0, content };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`${ms}ms — FAIL: ${msg.slice(0, 120)}`);
    return { model, ms, ok: false, error: msg };
  }
}

async function main() {
  console.log("Resolving managed credentials...");
  const t0 = Date.now();
  const creds = await resolveManagedOpenRouterCredentials();
  console.log(`  route=${creds.route} (${Date.now() - t0}ms)`);
  if (creds.route !== "managed") {
    console.error("Managed inference not active.");
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    timeout: CALL_TIMEOUT_MS,
  });

  console.log(`\nProbing ${MODELS.length} model(s), ${CALL_TIMEOUT_MS / 1000}s timeout each:\n`);
  for (const model of MODELS) {
    const headers = buildManagedInferenceClientHeaders(null, model);
    await probe(client, model, headers);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
