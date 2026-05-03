import type { ToolRegistry, AgentEmitter, AgentHarness } from "@liminal/core";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { listDirTool } from "./list_dir.js";
import { runShellTool } from "./run_shell.js";
import { webFetchTool } from "./web_fetch.js";
import { webSearchTool } from "./web_search.js";
import { createAskUserTool } from "./ask_user.js";
import { rememberTool, recallTool, recallByTypeTool, forgetTool, forgetTypeTool, memoryStatsTool } from "./remember_recall.js";
import { thinkTool } from "./think.js";
import { planTool } from "./plan.js";
import { searchMemoryTool } from "./search_memory.js";
import { createOrchestrationTools } from "./orchestration.js";
import {
  runBackgroundTool,
  killProcessTool,
  listProcessesTool,
  readProcessOutputTool,
} from "./process_manager.js";
import { suggestImprovementTool, viewInsightsTool } from "./meta_tools.js";
import { createContextTools } from "./context_tools.js";
import { createRefreshWorldContextTool } from "./refresh_world_context.js";
import { createSetPersonaTool } from "./set_persona.js";

/**
 * Register all tools onto a registry.
 * Pass `harness` to also register orchestration tools + context tools scoped to that harness.
 */
export function registerAllTools(
  registry: ToolRegistry,
  emitter: AgentEmitter,
  harness?: AgentHarness
): void {
  registry.register(thinkTool);
  registry.register(planTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(listDirTool);
  registry.register(runShellTool);
  registry.register(runBackgroundTool);
  registry.register(killProcessTool);
  registry.register(listProcessesTool);
  registry.register(readProcessOutputTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(createAskUserTool(emitter));
  registry.register(rememberTool);
  registry.register(recallTool);
  registry.register(recallByTypeTool);
  registry.register(forgetTool);
  registry.register(forgetTypeTool);
  registry.register(memoryStatsTool);
  registry.register(searchMemoryTool);
  registry.register(suggestImprovementTool);
  registry.register(viewInsightsTool);

  if (harness) {
    // Orchestration tools (spawn_agent, wait_for_agents, cancel_agent, list_agents, verify_result)
    const { spawnAgentTool, waitForAgentsTool, cancelAgentTool, listAgentsTool, verifyResultTool } =
      createOrchestrationTools(harness);
    registry.register(spawnAgentTool);
    registry.register(waitForAgentsTool);
    registry.register(cancelAgentTool);
    registry.register(listAgentsTool);
    registry.register(verifyResultTool);

    // Context budget tools (check_context, compress_context) — close over harness context
    const { checkContextTool, compressContextTool } = createContextTools(harness.getContext());
    registry.register(checkContextTool);
    registry.register(compressContextTool);

    // World context refresh — root-only, excluded from child registries
    registry.register(createRefreshWorldContextTool(harness));

    // Inline persona switching — closes over this specific harness instance
    registry.register(createSetPersonaTool(harness));
  }
}

export { createAskUserTool } from "./ask_user.js";
export { INCEPTION_MESSAGES, buildInceptionMessages } from "./systemPrompt.js";
export { buildPersonaBlock, buildRichPersonaBlock } from "./persona_presets.js";
export type { PersonaProfile, SpeechStyle, PersonaTone } from "./persona_presets.js";
export { createOrchestrationTools } from "./orchestration.js";
export { createContextTools } from "./context_tools.js";
export { createSetPersonaTool } from "./set_persona.js";
