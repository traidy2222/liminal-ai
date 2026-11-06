#!/usr/bin/env node
/** Opt-in live comparisons with one global call/time/conservative-cost budget. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { matchesRequestedRecord } from "./lib/procedure-oracle.mjs";
const args = process.argv.slice(2),
  get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined),
  num = (k) => Number(get(k));
if (!args.includes("--live"))
  throw new Error(
    "Opt-in required: --live --model MODEL --base-url URL --max-calls N --max-seconds N --max-usd N --input-usd-per-million N --output-usd-per-million N",
  );
const caps = {
  calls: num("--max-calls"),
  seconds: num("--max-seconds"),
  usd: num("--max-usd"),
  inputPrice: num("--input-usd-per-million"),
  outputPrice: num("--output-usd-per-million"),
};
if (
  Object.values(caps).some((v) => !Number.isFinite(v) || v <= 0) ||
  !Number.isInteger(caps.calls) ||
  caps.calls > 100 ||
  caps.seconds > 1800 ||
  caps.usd > 25
)
  throw new Error(
    "Explicit positive caps required; maxima: 100 requests, 1800 seconds, $25",
  );
const outputTokens = Number(get("--max-output-tokens") ?? 1024),
  turnSeconds = Number(get("--max-turn-seconds") ?? 90),
  seed = Number(get("--seed") ?? 101),
  armOrder = (get("--arm-order") ?? "A,B,C,D").split(","),
  phases = ["acquire", ...(get("--phases") ?? "transfer").split(",")];
if (
  !Number.isSafeInteger(outputTokens) ||
  outputTokens < 128 ||
  outputTokens > 8192 ||
  !(turnSeconds > 0 && turnSeconds <= 180) ||
  !Number.isSafeInteger(seed) ||
  armOrder.length > 12 ||
  armOrder.some((m) => !["A", "B", "C", "D"].includes(m)) ||
  phases.some(
    (p) => !["acquire", "transfer", "unrelated", "drift"].includes(p),
  ) ||
  new Set(phases).size !== phases.length
)
  throw new Error("Invalid bounded plan/output/seed configuration");
const model = get("--model"),
  base = new URL(get("--base-url")),
  key =
    process.env.AGENT_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.OPENAI_API_KEY;
if (!key || !model)
  throw new Error(
    "Provide a model/base URL and API key in the environment; saved app configuration is not loaded",
  );
if (
  base.protocol !== "https:" &&
  !(
    base.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(base.hostname)
  )
)
  throw new Error("Provider must use HTTPS or local loopback");
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  root = path.resolve(
    get("--output") ??
      path.join(repo, ".agent_artifacts/procedural-memory/live-" + Date.now()),
  );
await fs.mkdir(root);
const started = Date.now(),
  deadline = started + caps.seconds * 1000,
  proxyToken = randomUUID(),
  requests = [],
  outcomes = [],
  controllers = new Set();
let calls = 0,
  reservedUsd = 0,
  exhausted = false,
  current = null;
const progress = () =>
  fs.writeFile(
    path.join(root, "progress.json"),
    JSON.stringify(
      {
        root,
        calls,
        reservedUsd,
        elapsedMs: Date.now() - started,
        exhausted,
        current,
        completed: outcomes,
      },
      null,
      2,
    ),
  );
const proxy = createServer(async (req, res) => {
  let row;
  try {
    if (req.headers.authorization !== `Bearer ${proxyToken}`)
      throw new Error("Unauthorized budget proxy request");
    if (req.method !== "POST" || req.url !== "/v1/chat/completions")
      throw new Error("Only chat completions allowed");
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 200000)
        throw new Error("Input exceeds fixed budget");
    }
    const json = JSON.parse(body);
    if (json.model !== model)
      throw new Error("Unexpected model in single-model comparison");
    const tokens = Math.min(
      outputTokens,
      Number(json.max_tokens ?? json.max_completion_tokens ?? outputTokens),
    );
    if (!Number.isSafeInteger(tokens) || tokens <= 0)
      throw new Error("Invalid token cap");
    delete json.max_completion_tokens;
    json.max_tokens = tokens;
    if (current) json.seed = current.seed;
    if (base.hostname === "openrouter.ai")
      json.provider = { ...(json.provider ?? {}), sort: "latency" };
    const inputBound = Buffer.byteLength(JSON.stringify(json)) * 2 + 4096,
      upper = (inputBound * caps.inputPrice + tokens * caps.outputPrice) / 1e6;
    if (
      exhausted ||
      Date.now() >= deadline ||
      calls >= caps.calls ||
      reservedUsd + upper > caps.usd
    ) {
      exhausted = true;
      throw new Error("Explicit call/time/cost cap exhausted");
    }
    calls++;
    reservedUsd += upper;
    row = {
      call: calls,
      model,
      ...current,
      inputTokenReservation: inputBound,
      outputTokenCap: tokens,
      reservedUsd: upper,
      at: Date.now(),
      firstByteMs: null,
      firstContentMs: null,
      usage: null,
      toolSchemaChars: JSON.stringify(json.tools ?? []).length,
      toolNames: (json.tools ?? []).map((tool) => tool.function?.name),
      messageChars: JSON.stringify(json.messages ?? []).length,
      procedureDataChars: (json.messages ?? [])
        .filter(
          (message) =>
            typeof message.content === "string" &&
            /^\[PROCEDUR/.test(message.content),
        )
        .reduce((sum, message) => sum + message.content.length, 0),
    };
    requests.push(row);
    await progress();
    const abort = new AbortController();
    controllers.add(abort);
    const timer = setTimeout(
      () => abort.abort(),
      Math.max(1, deadline - Date.now()),
    );
    try {
      const upstream = await fetch(
        base.href.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(json),
          signal: abort.signal,
        },
      );
      row.status = upstream.status;
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
      });
      const decoder = new TextDecoder();
      const streaming = upstream.headers
        .get("content-type")
        ?.includes("text/event-stream");
      let buffered = "";
      const observe = (value) => {
        if (value.id) row.generationId = value.id;
        if (value.usage) row.usage = value.usage;
        if (
          row.firstContentMs === null &&
          value.choices?.some(
            (c) =>
              c.delta?.content ||
              c.delta?.tool_calls?.length ||
              c.message?.content,
          )
        )
          row.firstContentMs = Date.now() - row.at;
      };
      if (upstream.body)
        for await (const chunk of Readable.fromWeb(upstream.body)) {
          if (Date.now() >= deadline) throw new Error("Time cap exhausted");
          if (row.firstByteMs === null) row.firstByteMs = Date.now() - row.at;
          buffered += decoder.decode(chunk, { stream: true });
          if (!streaming) {
            if (buffered.length > 2000000)
              throw new Error(
                "Non-streaming response exceeds observation budget",
              );
            res.write(chunk);
            continue;
          }
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const value = JSON.parse(line.slice(5).trim());
              observe(value);
            } catch {}
          }
          res.write(chunk);
        }
      if (!streaming && buffered) {
        try {
          observe(JSON.parse(buffered + decoder.decode()));
        } catch {
          /* Retain full reservation when no complete usage is available. */
        }
      }
      res.end();
    } finally {
      clearTimeout(timer);
      controllers.delete(abort);
      row.elapsedMs = Date.now() - row.at;
      const usage = row.usage;
      const completeUsage =
        usage &&
        [usage.prompt_tokens, usage.completion_tokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        );
      row.accountedUsd = completeUsage
        ? (usage.prompt_tokens * caps.inputPrice +
            usage.completion_tokens * caps.outputPrice) /
          1e6
        : upper;
      reservedUsd += row.accountedUsd - upper;
      await progress();
    }
  } catch (error) {
    if (row) row.error = String(error);
    if (!res.headersSent)
      res.writeHead(exhausted ? 400 : 502, {
        "Content-Type": "application/json",
      });
    res.end(JSON.stringify({ error: { message: String(error) } }));
  }
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyURL = `http://127.0.0.1:${proxy.address().port}/v1`;
const convention = {
  schemaVersion: 1,
  family: "json-record",
  name: "Register provider",
  directory: "src/providers",
  filenameParameter: "name",
  fields: {
    name: { parameter: "name" },
    symbol: { parameter: "symbol" },
    kind: { constant: "provider" },
  },
  allowAdditionalFields: false,
};
const taskByPhase = {
  acquire: { name: "cedar", symbol: "Cedar", directory: "src/providers" },
  transfer: { name: "maple", symbol: "Maple", directory: "src/providers" },
  unrelated: { name: "birch", symbol: "Birch", directory: "src/providers" },
  drift: { name: "juniper", symbol: "Juniper", directory: "src/extensions" },
};
await fs.writeFile(
  path.join(root, "frozen-oracle.json"),
  JSON.stringify({ convention, tasks: taskByPhase }, null, 2),
);
const repetitions = {};
try {
  outer: for (const mode of armOrder) {
    const repeat = (repetitions[mode] = (repetitions[mode] ?? 0) + 1),
      run = mode + "-" + repeat,
      baseRoot = path.join(root, run);
    await fs.mkdir(path.join(baseRoot, "repo"), { recursive: true });
    await fs.writeFile(
      path.join(baseRoot, "repo/convention.json"),
      JSON.stringify(convention),
    );
    // Same genuine pre-existing defect for all acquisition arms.
    await fs.mkdir(path.join(baseRoot, "repo/src/providers"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(baseRoot, "repo/src/providers/cedar.json"),
      JSON.stringify({ name: "cedar", symbol: "Cedar", kind: "component" }),
    );
    for (const phase of phases) {
      if (exhausted || Date.now() >= deadline || calls >= caps.calls) {
        exhausted = true;
        break outer;
      }
      current = { mode, repeat, run, phase, seed: seed + repeat - 1 };
      const task = taskByPhase[phase];
      if (phase === "unrelated")
        await fs.writeFile(
          path.join(baseRoot, "repo/README.md"),
          "Unrelated documentation edit only.",
        );
      if (phase === "drift")
        await fs.writeFile(
          path.join(baseRoot, "repo/convention.json"),
          JSON.stringify({ ...convention, directory: "src/extensions" }),
        );
      const before = calls,
        start = Date.now();
      await progress();
      const turnLimit = Math.min(turnSeconds * 1000, deadline - Date.now());
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(repo, "packages/eval/src/procedural/comparison_worker.ts"),
          baseRoot,
          mode,
          phase,
        ],
        {
          cwd: repo,
          windowsHide: true,
          env: {
            ...process.env,
            AGENT_API_KEY: proxyToken,
            OPENROUTER_API_KEY: proxyToken,
            OPENAI_API_KEY: proxyToken,
            AGENT_API_BASE_URL: proxyURL,
            AGENT_INFERENCE_MODE: "byok",
            AGENT_INFERENCE_PREFER_MANAGED: "0",
            PROCEDURE_LIVE:
              phase === "acquire" && args.includes("--scripted-acquisition")
                ? "0"
                : "1",
            PROCEDURE_PROXY_URL: proxyURL,
            PROCEDURE_MODEL: model,
            PROCEDURE_PROXY_TOKEN: proxyToken,
            AGENT_MODEL: model,
            AGENT_FAST_MODEL: model,
            AGENT_SINGLE_MODEL: "1",
            AGENT_MAX_COMPLETION_TOKENS: String(outputTokens),
            AGENT_PROVIDER_STRATEGY: "latency",
            AGENT_SEND_TIMEOUT_MS: String(turnLimit),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "",
        timedOut = false;
      child.stdout.on("data", (b) => (log += b));
      child.stderr.on("data", (b) => (log += b));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, turnLimit);
      const code = await new Promise((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      });
      clearTimeout(timer);
      await fs.writeFile(path.join(baseRoot, phase + ".process.log"), log);
      let actual = null,
        workerReport = null;
      try {
        actual = JSON.parse(
          await fs.readFile(
            path.join(baseRoot, "repo", task.directory, task.name + ".json"),
            "utf8",
          ),
        );
      } catch {}
      try {
        workerReport = JSON.parse(
          await fs.readFile(
            path.join(baseRoot, phase + ".report.json"),
            "utf8",
          ),
        );
      } catch {}
      let staleSideEffect = false;
      if (phase === "drift")
        try {
          await fs.stat(
            path.join(baseRoot, "repo/src/providers", task.name + ".json"),
          );
          staleSideEffect = true;
        } catch {}
      const turnRequests = requests.filter(
          (r) => r.run === run && r.phase === phase,
        ),
        reportedCosts = turnRequests.filter(
          (r) => typeof r.usage?.cost === "number",
        );
      const outcome = {
        ...current,
        controller: workerReport?.controller ?? null,
        exitCode: code,
        timedOut,
        elapsedMs: Date.now() - start,
        correct: matchesRequestedRecord(actual, task),
        staleSideEffect,
        providerCalls: calls - before,
        reportedTokens:
          turnRequests.length &&
          turnRequests.every(
            (r) =>
              r.usage &&
              Number.isSafeInteger(r.usage.prompt_tokens) &&
              Number.isSafeInteger(r.usage.completion_tokens),
          )
            ? turnRequests.reduce(
                (sum, r) =>
                  sum + r.usage.prompt_tokens + r.usage.completion_tokens,
                0,
              )
            : null,
        logicalCompletions: workerReport?.logicalCompletions ?? null,
        dependencyRechecks: workerReport?.dependencyRechecks ?? null,
        schemaReadinessChecks: workerReport?.schemaReadinessChecks ?? null,
        toolCalls: workerReport?.toolCalls ?? null,
        toolFailures: workerReport?.toolFailures ?? null,
        reused: workerReport?.reused ?? false,
        abstained: workerReport?.abstained ?? false,
        retainedActive: workerReport?.retainedActive ?? null,
        activeProcedures: workerReport?.activeProcedures ?? [],
        terminationReason: workerReport?.terminationReason ?? null,
        providerReportedCost:
          reportedCosts.length === turnRequests.length && turnRequests.length
            ? reportedCosts.reduce((n, r) => n + r.usage.cost, 0)
            : null,
      };
      await fs.writeFile(
        path.join(baseRoot, phase + ".evaluation.json"),
        JSON.stringify(
          { ...outcome, task, recordedAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      outcomes.push(outcome);
      await progress();
      console.log(JSON.stringify({ progress: outcome }));
    }
  }
} finally {
  for (const controller of controllers) controller.abort();
  proxy.closeAllConnections();
  proxy.close();
  await fs.writeFile(
    path.join(root, "live-results.json"),
    JSON.stringify(
      {
        caps,
        outputTokens,
        turnSeconds,
        armOrder,
        phases,
        seed,
        model,
        baseURL: base.href,
        calls,
        reservedUsd,
        elapsedMs: Date.now() - started,
        exhausted,
        outcomes,
        requests,
        actualBilledCost: null,
        limitations: [
          "Small selected task family, not general intelligence",
          "Requested seed may not be guaranteed by provider",
          "Cost reservation uses declared prices; provider-reported costs are not an invoice",
          "Budget exhaustion leaves incomplete arms; keep them visible",
        ],
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    root,
    calls,
    reservedUsd,
    exhausted,
    completedTurns: outcomes.length,
  }),
);
