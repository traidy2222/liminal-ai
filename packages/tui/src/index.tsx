import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink";
import { AgentHarness } from "@dreamthedream/core";
import { registerAllTools, INCEPTION_MESSAGES } from "@dreamthedream/tools";
import { App } from "./App.js";

// Load .env from monorepo root (cwd when running from packages/tui is that package dir)
config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("Error: OPENROUTER_API_KEY not found. Check the .env file at the monorepo root.");
  process.exit(1);
}

const harness = new AgentHarness({
  openRouterApiKey: apiKey,
  model: "poolside/laguna-xs.2:free",
  baseURL: "https://openrouter.ai/api/v1",
  maxToolRoundsPerTurn: 500,
  // World context: auto-gather date/time/OS/shell; optionally include location
  // Set AGENT_LOCATION="City, Country" in .env to include physical location
  worldContext: process.env["AGENT_LOCATION"]
    ? { location: process.env["AGENT_LOCATION"] }
    : undefined,
  context: {
    modelMaxTokens: 128_000,
    thresholdFraction: 0.8,
    inceptionMessages: INCEPTION_MESSAGES,
  },
});

registerAllTools(harness.registry, harness.emitter, harness);

render(<App harness={harness} />);
