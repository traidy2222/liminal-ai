/**
 * Attach all Google Workspace MCP connections (after OAuth).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvForCli } from "./load-env.mjs";
import { resolveRepoRoot } from "./paths.mjs";

/** @param {{ services?: string[]; mode?: "read_write" | "read_only" }} [opts] */
export async function attachGoogleWorkspaceMcp(opts = {}) {
  loadEnvForCli();
  const repoRoot = resolveRepoRoot();
  process.env.AGENT_WORKSPACE_ROOT =
    process.env.AGENT_WORKSPACE_ROOT?.trim() || repoRoot;

  const coreUrl = pathToFileURL(path.join(repoRoot, "packages/core/dist/index.js")).href;
  const toolsUrl = pathToFileURL(path.join(repoRoot, "packages/tools/dist/index.js")).href;

  let AgentHarness;
  let registerAllTools;
  let connectGoogleWorkspaceFromServer;
  try {
    ({ AgentHarness } = await import(coreUrl));
    ({ registerAllTools, connectGoogleWorkspaceFromServer } = await import(toolsUrl));
  } catch {
    console.error("Build packages first: npm run build -w packages/core && npm run build -w packages/tools");
    return 1;
  }

  const harness = new AgentHarness({
    openRouterApiKey: process.env.AGENT_API_KEY?.trim() || "cli-google-attach",
    model: process.env.AGENT_MODEL?.trim() || "deepseek/deepseek-chat",
    baseURL: process.env.AGENT_API_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    maxToolRoundsPerTurn: 4,
    workspaceRoot: process.env.AGENT_WORKSPACE_ROOT,
    context: {
      modelMaxTokens: 128_000,
      thresholdFraction: 0.6,
      inceptionMessages: [{ role: "system", content: "cli" }],
    },
  });

  await registerAllTools(harness.registry, harness.emitter, harness);

  const result = await connectGoogleWorkspaceFromServer(harness.registry, {
    services: opts.services,
    mode: opts.mode ?? "read_write",
  });

  if (!result.ok) {
    console.error(result.error ?? "connect_provider failed");
    return 1;
  }

  console.log(result.output ?? "Google Workspace MCP attached.");
  console.log(
    "\nConnections saved under ~/.liminal/api_connections/. " +
      "Set AGENT_GOOGLE_CONNECT_ON_BOOT=1 in .env to restore on web/tui startup."
  );
  return 0;
}
