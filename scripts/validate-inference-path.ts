#!/usr/bin/env tsx
/**
 * End-to-end validation for the inference path:
 * desktop -> sidecar -> harness -> api.vireondynamics.com
 *
 * Usage: npx tsx scripts/validate-inference-path.ts
 */

import {
  resolveProviderConfig,
  resolveProviderConfigWithInference,
  resolveInferenceMode,
  resolveManagedOpenRouterCredentials,
  fetchInferenceUsageStatus,
  fetchManagedInferenceModels,
  inferenceTopUpHint,
  managedInferenceBaseUrl,
  resolveManagedProviderPreference,
  isManagedInferenceAuthError,
  isInferenceBudgetExceededError,
  type InferenceMode,
  type ManagedInferenceModelsResult,
  type InferenceUsageStatus,
} from "@liminal/core";
import { OpenAI } from "openai";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function log(msg: string) {
  console.log(msg);
}

function success(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function fail(msg: string) {
  console.log(`${RED}✗${RESET} ${msg}`);
}

function warn(msg: string) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

function section(title: string) {
  console.log(`\n${CYAN}=== ${title} ===${RESET}`);
}

function dim(msg: string) {
  console.log(`${DIM}${msg}${RESET}`);
}

interface ValidationResult {
  step: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
  error?: Error;
}

const results: ValidationResult[] = [];

async function validateManagedInferenceBaseUrl(): Promise<ValidationResult> {
  const step = "Managed inference base URL";
  try {
    const baseUrl = managedInferenceBaseUrl();
    const expected = "https://api.vireondynamics.com/v1/inference";
    const passed = baseUrl === expected;
    const result: ValidationResult = {
      step,
      passed,
      message: passed
        ? `Base URL matches: ${baseUrl}`
        : `Base URL mismatch: ${baseUrl} (expected ${expected})`,
      details: { baseUrl, expected },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve managed inference base URL",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateInferenceModeResolution(): Promise<ValidationResult> {
  const step = "Inference mode resolution";
  try {
    const mode = resolveInferenceMode();
    const validModes: InferenceMode[] = ["auto", "managed", "byok"];
    const passed = validModes.includes(mode);
    const result: ValidationResult = {
      step,
      passed,
      message: passed ? `Mode: ${mode}` : `Invalid mode: ${mode}`,
      details: { mode, validModes },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve inference mode",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateManagedProviderPreference(): Promise<ValidationResult> {
  const step = "Managed provider preference";
  try {
    const pref = resolveManagedProviderPreference();
    const validPrefs = ["auto", "bedrock", "openrouter", "kimchi"];
    const passed = validPrefs.includes(pref);
    const result: ValidationResult = {
      step,
      passed,
      message: passed ? `Provider preference: ${pref}` : `Invalid preference: ${pref}`,
      details: { preference: pref, validPrefs },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve managed provider preference",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateBYOKProviderResolution(): Promise<ValidationResult> {
  const step = "BYOK provider resolution (sync)";
  try {
    const config = resolveProviderConfig();
    const hasKey = Boolean(config.apiKey?.trim());
    const hasBase = Boolean(config.baseURL?.trim());
    const hasModel = Boolean(config.model?.trim());
    const passed = hasKey && hasBase && hasModel;
    const result: ValidationResult = {
      step,
      passed,
      message: passed
        ? `BYOK provider: ${config.keySource} @ ${config.baseURL}`
        : `Missing config: key=${hasKey}, base=${hasBase}, model=${hasModel}`,
      details: {
        keySource: config.keySource,
        baseURL: config.baseURL,
        model: config.model,
        hasKey,
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve BYOK provider",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateProviderWithInference(): Promise<ValidationResult> {
  const step = "Provider resolution with inference";
  try {
    const config = await resolveProviderConfigWithInference();
    const isManagedRoute = config.keySource === "VIREON_MANAGED";
    const hasKey = Boolean(config.apiKey?.trim());
    const hasBase = Boolean(config.baseURL?.trim());
    const hasModel = Boolean(config.model?.trim());
    const passed = hasKey && hasBase && hasModel;
    const result: ValidationResult = {
      step,
      passed,
      message: passed
        ? `Provider: ${config.keySource} @ ${config.baseURL} (${config.model})`
        : `Missing config: key=${hasKey}, base=${hasBase}, model=${hasModel}`,
      details: {
        keySource: config.keySource,
        baseURL: config.baseURL,
        model: config.model,
        isManagedRoute,
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve provider with inference",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateManagedCredentials(): Promise<ValidationResult> {
  const step = "Managed OpenRouter credentials";
  try {
    const creds = await resolveManagedOpenRouterCredentials();
    const isManaged = creds.route === "managed";
    const hasToken = Boolean(creds.apiKey?.trim());
    const hasBase = Boolean(creds.baseURL?.trim());
    const isManagedBase = creds.baseURL.includes("/inference");
    const passed = hasToken && hasBase && (isManaged ? isManagedBase : true);
    const result: ValidationResult = {
      step,
      passed,
      message: passed
        ? `Credentials resolved: route=${creds.route}, base=${creds.baseURL}`
        : `Missing credentials or wrong base`,
      details: {
        route: creds.route,
        baseURL: creds.baseURL,
        hasToken,
        isManagedBase,
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to resolve managed credentials",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateInferenceUsageStatus(): Promise<ValidationResult> {
  const step = "Inference usage status";
  try {
    const status = await fetchInferenceUsageStatus();
    if (!status) {
      const result: ValidationResult = {
        step,
        passed: true,
        message: "No Pro license — usage status N/A (expected for CE)",
        details: { hasLicense: false },
      };
      results.push(result);
      return result;
    }
    const hasRemaining = status.remainingUsd !== null && status.remainingUsd > 0;
    const passed = status.entitled && hasRemaining;
    const result: ValidationResult = {
      step,
      passed: true,
      message: passed
        ? `Credits: $${status.remainingUsd?.toFixed(2) ?? 0} remaining`
        : status.entitled
          ? "Credits exhausted"
          : "Not entitled",
      details: {
        configured: status.configured,
        entitled: status.entitled,
        remainingUsd: status.remainingUsd,
        capUsd: status.capUsd,
        usedUsd: status.usedUsd,
        periodEnd: status.periodEnd,
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to fetch inference usage status",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateManagedInferenceCatalog(): Promise<ValidationResult> {
  const step = "Managed inference models catalog";
  try {
    const catalog = await fetchManagedInferenceModels();
    if (!catalog) {
      const result: ValidationResult = {
        step,
        passed: true,
        message: "No Pro license — catalog N/A (expected for CE)",
        details: { hasLicense: false },
      };
      results.push(result);
      return result;
    }
    const modelCount = catalog.models?.length ?? 0;
    const passed = modelCount > 0;
    const result: ValidationResult = {
      step,
      passed: true,
      message: passed
        ? `Catalog: ${modelCount} models from ${catalog.upstream} (${catalog.region})`
        : "Empty catalog",
      details: {
        upstream: catalog.upstream,
        region: catalog.region,
        modelCount,
        sampleModels: catalog.models?.slice(0, 5).map((m) => m.id),
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    const result: ValidationResult = {
      step,
      passed: false,
      message: "Failed to fetch managed inference models",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    results.push(result);
    return result;
  }
}

async function validateChatCompletionCall(): Promise<ValidationResult> {
  const step = "Chat completion call (sidecar -> managed inference)";
  try {
    const creds = await resolveManagedOpenRouterCredentials();
    if (creds.route !== "managed") {
      const result: ValidationResult = {
        step,
        passed: true,
        message: `BYOK route active — skipping managed inference call test`,
        details: { route: creds.route },
      };
      results.push(result);
      return result;
    }

    const config = await resolveProviderConfigWithInference();
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

    const start = Date.now();
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: "Reply with exactly one word: pong" },
        { role: "user", content: "ping" },
      ],
      max_tokens: 10,
    });
    const latencyMs = Date.now() - start;

    const content = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const passed = content.length > 0;

    const result: ValidationResult = {
      step,
      passed,
      message: passed
        ? `Completion OK (${latencyMs}ms): "${content.slice(0, 50)}"`
        : "Empty completion",
      details: {
        model: config.model,
        baseURL: config.baseURL,
        latencyMs,
        content: content.slice(0, 100),
      },
    };
    results.push(result);
    return result;
  } catch (error) {
    let message = "Chat completion failed";
    let details: Record<string, unknown> = {};

    if (error instanceof Error) {
      message = error.message;
      if (isInferenceBudgetExceededError(error)) {
        message = `Budget exceeded. ${inferenceTopUpHint()}`;
      } else if (isManagedInferenceAuthError(error)) {
        message = "Auth error — check license or session token";
      }
      details.errorType = error.constructor.name;
      details.errorMessage = error.message;
    }

    const result: ValidationResult = {
      step,
      passed: false,
      message,
      error: error instanceof Error ? error : new Error(String(error)),
      details,
    };
    results.push(result);
    return result;
  }
}

function printSummary() {
  section("Summary");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`\nPassed: ${passed}/${total}`);
  console.log(`Failed: ${failed}/${total}`);

  if (failed > 0) {
    console.log("\nFailed steps:");
    for (const r of results.filter((r) => !r.passed)) {
      fail(`${r.step}: ${r.message}`);
      if (r.error && typeof r.error === "object" && "message" in r.error) {
        dim(`  Error: ${r.error.message}`);
      }
    }
  }

  console.log("");
  if (failed === 0) {
    success("All validation steps passed.");
  } else {
    fail(`${failed} validation step(s) failed.`);
  }
}

function printGapAnalysis() {
  section("Gap Analysis");

  const gaps: string[] = [];

  const byokResult = results.find((r) => r.step === "BYOK provider resolution (sync)");
  if (byokResult && !byokResult.passed) {
    gaps.push("- No local BYOK provider configured — set AGENT_API_KEY in .env for fallback");
  }

  const credsResult = results.find((r) => r.step === "Managed OpenRouter credentials");
  if (credsResult && credsResult.details?.route === "managed") {
    const baseResult = results.find((r) => r.step === "Managed inference base URL");
    if (baseResult && !baseResult.passed) {
      gaps.push("- Managed inference base URL mismatch — check AGENT_INFERENCE_BASE_URL");
    }
  }

  const usageResult = results.find((r) => r.step === "Inference usage status");
  if (usageResult?.details?.hasLicense === false) {
    gaps.push("- No Vireon Pro license detected — managed inference requires sign-in (`liminal login`)");
  } else if (usageResult?.details?.remainingUsd !== null && (usageResult?.details?.remainingUsd ?? 0) <= 0) {
    gaps.push("- Managed inference credits exhausted — top up at " + inferenceTopUpHint());
  }

  const callResult = results.find((r) => r.step === "Chat completion call (sidecar -> managed inference)");
  if (callResult && !callResult.passed) {
    gaps.push("- Chat completion call failed — check provider routing and API connectivity");
  }

  if (gaps.length === 0) {
    success("No gaps detected in the inference path.");
  } else {
    warn(`Detected ${gaps.length} gap(s):`);
    for (const gap of gaps) {
      console.log(`  ${gap}`);
    }
  }
}

async function main() {
  console.log("\nLiminal Inference Path Validation\n");
  console.log("This script validates the end-to-end inference path:");
  console.log("  desktop -> sidecar -> harness -> api.vireondynamics.com\n");

  section("Core Configuration");
  await validateManagedInferenceBaseUrl();
  await validateInferenceModeResolution();
  await validateManagedProviderPreference();

  section("Provider Resolution");
  await validateBYOKProviderResolution();
  await validateProviderWithInference();
  await validateManagedCredentials();

  section("Managed Inference Status");
  await validateInferenceUsageStatus();
  await validateManagedInferenceCatalog();

  section("Live API Call");
  await validateChatCompletionCall();

  printSummary();
  printGapAnalysis();

  const failedCount = results.filter((r) => !r.passed).length;
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Validation script failed:", err);
  process.exit(1);
});
