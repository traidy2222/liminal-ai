import "./tuiWorkspaceBootstrap.js";
import React from "react";
import { render } from "ink";
import { AgentHarness } from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
} from "@liminal/tools";
import { App } from "./App.js";

/** Wall-clock cap for one user message (entire ReAct run). Env override: AGENT_SEND_TIMEOUT_MS */
function resolveSendTimeoutMs(): number {
  const raw = process.env["AGENT_SEND_TIMEOUT_MS"];
  if (raw === undefined || raw.trim() === "") return 600_000;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return 600_000;
  return Math.max(60_000, Math.min(n, 3_600_000));
}

/** Heuristic + LLM 0/1 gate to skip approval on safe calls. Env: AGENT_SAFETY_JUDGE=1 */
function resolveSafetyJudge():
  | { enabled: true; model?: string }
  | undefined {
  if (process.env["AGENT_SAFETY_JUDGE"] !== "1") return undefined;
  const model = process.env["AGENT_SAFETY_JUDGE_MODEL"]?.trim();
  return {
    enabled: true,
    ...(model ? { model } : {}),
  };
}

const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("Error: OPENROUTER_API_KEY not found. Check the .env file at the monorepo root.");
  process.exit(1);
}

const harness = new AgentHarness({
  openRouterApiKey: apiKey,
  model: "openrouter/owl-alpha",
  baseURL: "https://openrouter.ai/api/v1",
  maxToolRoundsPerTurn: 128,
  sendTimeoutMs: resolveSendTimeoutMs(),
  safetyJudge: resolveSafetyJudge(),
  workingStateEnabled: true,
  // World context: auto-gather date/time/OS/shell; optionally include location
  // Set AGENT_LOCATION="City, Country" in .env to include physical location
  worldContext: process.env["AGENT_LOCATION"]
    ? { location: process.env["AGENT_LOCATION"] }
    : undefined,
  context: {
    modelMaxTokens: 128_000,
    thresholdFraction: 0.8,
    inceptionMessages: INCEPTION_MESSAGES,
    protocolDynamicBuilder: (names) => buildProtocolDynamicSuffix(names),
  },
});

registerAllTools(harness.registry, harness.emitter, harness);

render(<App harness={harness} />);
