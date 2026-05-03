import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type {
  AgentConfig,
  Message,
  AccumulatedToolCall,
  ChildAgentConfig,
  SubtaskResult,
} from "./types.js";
import { AgentEmitter } from "./events.js";
import { ContextManager } from "./context.js";
import { ToolRegistry } from "./registry.js";
import { ToolDispatcher } from "./dispatcher.js";
import { StreamAccumulator } from "./streaming.js";
import { TaskOrchestrator } from "./orchestrator.js";
import { buildWorldContextMessage } from "./world_context.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Extract a human-readable message from any error the OpenAI SDK or
 * OpenRouter can throw.
 */
function describeError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    const body =
      typeof err.error === "object" && err.error !== null
        ? JSON.stringify(err.error)
        : String(err.error ?? err.message);
    return `HTTP ${err.status} from ${err.name}: ${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Returns true for errors worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof OpenAI.InternalServerError) return true;
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError && err.status != null && err.status >= 500)
    return true;
  if (
    err instanceof OpenAI.BadRequestError &&
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("provider")
  )
    return true;
  return false;
}

/** Simple djb2 hash → short hex string for recipe/reflexion key generation. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/**
 * Unified 12-category error taxonomy (#9 — TraceCoder arXiv:2602.06875 + Tool Invocation Reliability arXiv:2601.16280).
 * First match wins — ordered most-specific before general.
 */
const ERROR_TAXONOMY: Array<{
  pattern: RegExp;
  category: string;
  hint: string;
  template: string;
}> = [
  {
    pattern: /enoent|no such file|cannot find|path not found/i,
    category: "PATH_NOT_FOUND",
    hint: "File or directory does not exist at the given path.",
    template: "Use list_dir(parent_dir) to confirm the exact path exists, then retry with the corrected path.",
  },
  {
    pattern: /eperm|eacces|permission denied/i,
    category: "PERMISSION_DENIED",
    hint: "Insufficient filesystem permissions.",
    template: "Check file ownership. On Windows, ensure the process has write access to this directory.",
  },
  {
    pattern: /http 4[0-9][0-9]|status 4[0-9][0-9]|status: 4[0-9][0-9]/i,
    category: "HTTP_CLIENT_ERROR",
    hint: "Server rejected the request (4xx).",
    template: "Verify the URL with web_search first. Check auth headers, query parameters, and request body.",
  },
  {
    pattern: /http 5[0-9][0-9]|status 5[0-9][0-9]|status: 5[0-9][0-9]/i,
    category: "HTTP_SERVER_ERROR",
    hint: "Remote server returned a 5xx error.",
    template: "Retry once; if it persists, try a different endpoint or ask_user to confirm the service is available.",
  },
  {
    pattern: /invalid json|unexpected token|json parse|failed to parse/i,
    category: "JSON_PARSE_ERROR",
    hint: "Response or argument is malformed JSON.",
    template: "Double-check JSON syntax in args. Use think() to construct correct JSON before retrying.",
  },
  {
    pattern: /invalid args|missing required|expected |type mismatch|must be one of/i,
    category: "ARG_SCHEMA_MISMATCH",
    hint: "Tool argument types or required fields are wrong.",
    template: "Re-read the tool description carefully. Check exact types (string vs number vs array). Use think() to construct the correct args.",
  },
  {
    pattern: /timeout|timed out|deadline exceeded/i,
    category: "TIMEOUT",
    hint: "Operation exceeded its time limit.",
    template: "Reduce scope: split the work into smaller parts. For shell commands, use run_background for long-running processes.",
  },
  {
    pattern: /resource locked|lock held|locked by another/i,
    category: "RESOURCE_LOCK",
    hint: "Another agent holds a lock on this resource.",
    template: "Use list_agents() to see who holds the lock. Wait for them to finish, or work on a different resource.",
  },
  {
    pattern: /spawn.*failed|command not found|not found in path|is not recognized/i,
    category: "COMMAND_NOT_FOUND",
    hint: "The executable does not exist in PATH.",
    template: "Verify the command is installed. Use run_shell('which <cmd>') or run_shell('where <cmd>') to check.",
  },
  {
    pattern: /econnrefused|econnreset|getaddrinfo|network|dns lookup/i,
    category: "NETWORK_FAILURE",
    hint: "Network connectivity or DNS resolution failed.",
    template: "Check if the target service is reachable. Try a different URL or ask_user if the service requires VPN/auth.",
  },
  {
    pattern: /enomem|out of memory|heap out of memory/i,
    category: "MEMORY_PRESSURE",
    hint: "Process ran out of memory.",
    template: "Reduce data size: read files in chunks, limit shell output, or split into smaller sub-tasks.",
  },
  {
    pattern: /unknown tool|tool not found|not registered/i,
    category: "UNKNOWN_TOOL",
    hint: "Tool name is invalid or not available in this agent context.",
    template: "Only call tools explicitly listed in the system prompt. Sub-agents have a restricted tool set.",
  },
];

/** Pattern-match error string to a structured recovery hint. (#9) */
function buildRecoveryHint(errorSummary: string): string {
  for (const entry of ERROR_TAXONOMY) {
    if (entry.pattern.test(errorSummary)) {
      return `[${entry.category}] ${entry.hint}\nFix: ${entry.template}`;
    }
  }
  return "[UNKNOWN_ERROR] Use think() to diagnose the root cause. Examine the exact error message before retrying with different args.";
}

/** Per-tool adaptive hint shown after repeated consecutive failures. (#9 unified) */
function buildAdaptiveHint(toolName: string, failCount: number): string {
  const toolHints: Record<string, string> = {
    read_file: "Use list_dir first to confirm the exact path exists before retrying.",
    write_file: "Confirm the parent directory exists with list_dir; use absolute paths.",
    run_shell: "Check cwd and command syntax. For long processes, use run_background instead.",
    run_background: "Ensure the command is valid and cwd exists. Check startup_wait_ms.",
    web_fetch: "Verify the URL is correct with web_search first. Check for auth/redirects.",
    web_search: "Rephrase the query or use a more specific search term.",
    recall: "Key may differ — use search_memory to find it by content.",
    spawn_agent: "Check depth limits and concurrent count with list_agents first.",
    write_file_hint: "Read the file first to see current content, then write the full merged result.",
  };
  const hint = toolHints[toolName] ?? "Re-read the tool description and verify your argument types.";
  return `[ADAPTIVE HINT] ${toolName} has failed ${failCount} time(s) this turn. ${hint}`;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * Names of harness-scoped tools that must NOT be copied from parent to child registry.
 * Each child gets fresh instances of these (via onChildCreated) that close over the
 * correct harness/context reference. Copying the parent's version would either crash
 * (double-register) or silently use the wrong harness context.
 */
const ORCHESTRATION_TOOL_NAMES = new Set([
  "spawn_agent",
  "wait_for_agents",
  "cancel_agent",
  "list_agents",
  "verify_result",          // closes over harness.forkChild
  "check_context",          // closes over parent's ContextManager — child needs its own
  "compress_context",       // same
  "refresh_world_context",  // root-only; children skip world context entirely
]);

// ADAPTIVE_HINTS removed — unified into buildAdaptiveHint() with ERROR_TAXONOMY (#9)

export class AgentHarness {
  readonly emitter: AgentEmitter;
  registry: ToolRegistry;           // non-readonly so forkChild can scope it
  readonly config: AgentConfig;     // exposed for child harness creation
  readonly taskId: string;
  readonly orchestrator: TaskOrchestrator;
  readonly agentDepth: number;

  private readonly context: ContextManager;
  private readonly dispatcher: ToolDispatcher;
  private readonly client: OpenAI;
  private readonly maxAgentDepth: number;
  private readonly maxConcurrentAgents: number;
  private running = false;
  private abortSignal?: AbortSignal;

  /** Incremented each ReAct round; accessible for subtask result reporting. */
  roundCount = 0;

  /**
   * Called after forkChild creates a child harness, before running it.
   * Set by external code (orchestration tools) to register child-scoped tools.
   */
  onChildCreated?: (child: AgentHarness) => void;

  // ── Per-turn tracking (reset at start of each send()) ──────────────────────
  private toolErrorCounts = new Map<string, number>();
  private toolsUsedThisTurn: string[] = [];
  private lastUserMessage = "";
  private contextAlertFired60 = false;
  private contextAlertFired85 = false;

  /** True once world context has been injected (only happens on the first send() of a root agent). */
  private worldContextInjected = false;

  /**
   * Returns the ContextManager for use by context tools factory.
   * @internal — used by packages/tools createContextTools factory.
   */
  getContext(): ContextManager {
    return this.context;
  }

  private get maxRetries() {
    return this.config.maxRetries ?? 3;
  }
  private get retryDelayMs() {
    return this.config.retryDelayMs ?? 1500;
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.taskId = config.taskId ?? crypto.randomUUID();
    this.agentDepth = config.agentDepth ?? 0;
    this.maxAgentDepth = config.maxAgentDepth ?? 3;
    this.maxConcurrentAgents = config.maxConcurrentAgents ?? 8;

    this.emitter = new AgentEmitter();
    this.registry = new ToolRegistry();
    // Wire onCompressed callback so context compression fires a structured event (#7)
    this.context = new ContextManager({
      ...config.context,
      onCompressed: (before, after, rounds) => {
        this.emitter.emit("context_compressed", {
          beforeFraction: before,
          afterFraction: after,
          roundsCompressed: rounds,
        });
      },
    });

    // Root creates orchestrator; children receive the same instance
    this.orchestrator =
      config.orchestrator ?? new TaskOrchestrator();

    this.dispatcher = new ToolDispatcher(
      this.registry,
      this.emitter,
      this.orchestrator,
      this.taskId
    );

    this.client = new OpenAI({
      apiKey: config.openRouterApiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/dreamthedream",
        "X-Title": "dreamthedream",
      },
    });

    // Register self in orchestrator
    this.orchestrator.register({
      taskId: this.taskId,
      parentTaskId: config.parentTaskId,
      goal: "(root)",
      depth: this.agentDepth,
      startedAt: Date.now(),
      status: "running",
      abortController: new AbortController(),
    });
  }

  async send(userMessage: string): Promise<void> {
    if (this.running) throw new Error("Agent is already processing a message");
    this.running = true;

    // Reset per-turn tracking state
    this.toolErrorCounts = new Map();
    this.toolsUsedThisTurn = [];
    this.lastUserMessage = userMessage;
    this.contextAlertFired60 = false;
    this.contextAlertFired85 = false;

    // Hard wall-clock timeout (#3 — ReliabilityBench arXiv:2601.06112)
    const timeoutMs = this.config.sendTimeoutMs ?? 120_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`send() hard timeout after ${timeoutMs}ms — streaming API may be hung`)),
        timeoutMs
      );
    });

    try {
      // Inject world context on the first turn of a root agent (#world-context).
      // Child agents (depth > 0) skip this — they inherit context from their parent.
      if (!this.worldContextInjected && this.agentDepth === 0) {
        this.worldContextInjected = true;
        const worldCtx = await buildWorldContextMessage(this.config.worldContext);
        if (worldCtx) {
          this.context.append({ role: "user", content: worldCtx });
          // Brief acknowledgement so the model registers it as processed context,
          // not as a pending user request.
          this.context.append({
            role: "assistant",
            content:
              "[World context received. I'll use the current date/time, correct shell syntax, " +
              "and accurate path format for this platform throughout the session.]",
          });
        }
      }

      this.context.append({ role: "user", content: userMessage });
      await Promise.race([this.runReActLoop(), timeoutPromise]);

      // Episodic recipe recording (#7 AMA-Bench): persist successful patterns
      // Awaited with error boundary (#2 VIGIL) — no silent swallowing
      if (this.toolsUsedThisTurn.length >= 4 && this.registry.has("remember")) {
        const recipeKey = `recipe:${hashString(userMessage).slice(0, 10)}`;
        const recipeValue =
          `GOAL: ${userMessage.slice(0, 60)}\n` +
          `PATTERN: ${this.toolsUsedThisTurn.join(" → ")}\n` +
          `ROUNDS: ${this.roundCount}`;
        try {
          await this.dispatcher.directCall("remember", { key: recipeKey, value: recipeValue });
        } catch (err) {
          this.emitter.emit("text", {
            delta: `\n[HARNESS] Recipe persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
          });
        }
      }
    } catch (err) {
      this.emitter.emit("error", {
        err: new Error(describeError(err)),
      });
    } finally {
      clearTimeout(timeoutHandle);
      this.running = false;
    }
  }

  /** Returns the last assistant text message (used by parent to extract subtask result). */
  getLastAssistantMessage(): string {
    return this.context.getLastAssistantMessage() ?? "(no output)";
  }

  /**
   * Spawn a child AgentHarness to run a focused subtask independently.
   * Returns immediately with {taskId, promise}. Awaiting the promise blocks
   * until the child completes.
   */
  forkChild(
    childConfig: ChildAgentConfig
  ): { taskId: string; promise: Promise<SubtaskResult> } {
    // ── Depth / concurrency guards ───────────────────────────────────────────
    if (this.agentDepth >= this.maxAgentDepth) {
      throw new Error(
        `Max agent depth (${this.maxAgentDepth}) reached — cannot spawn further sub-agents`
      );
    }
    const running = this.orchestrator.runningCount();
    if (running >= this.maxConcurrentAgents) {
      throw new Error(
        `Max concurrent agents (${this.maxConcurrentAgents}) reached — wait for some to complete before spawning more`
      );
    }

    const childId = crypto.randomUUID();
    const abortController = new AbortController();

    // ── Build scoped tool registry ───────────────────────────────────────────
    const childRegistry = new ToolRegistry();
    const childDepth = this.agentDepth + 1;
    const depthAllowsOrchestration = childDepth < this.maxAgentDepth;

    for (const tool of this.registry.getAll()) {
      if (ORCHESTRATION_TOOL_NAMES.has(tool.name)) {
        // Skip parent's orchestration tools — child gets fresh ones below
        continue;
      }
      // If a toolNames filter is specified, only include allowed tools
      if (childConfig.toolNames && !childConfig.toolNames.includes(tool.name)) {
        continue;
      }
      childRegistry.register(tool);
    }

    // ── Build child inception messages ──────────────────────────────────────
    const childInceptionMessages: Message[] = [
      ...this.config.context.inceptionMessages,
      ...(childConfig.additionalContext
        ? [
            {
              role: "user" as const,
              content: `[SUBTASK CONTEXT] ${childConfig.additionalContext}`,
            },
          ]
        : []),
    ];

    // ── Create child harness ────────────────────────────────────────────────
    const childHarness = new AgentHarness({
      ...this.config,
      taskId: childId,
      parentTaskId: this.taskId,
      orchestrator: this.orchestrator,
      agentDepth: childDepth,
      maxAgentDepth: this.maxAgentDepth,
      maxConcurrentAgents: this.maxConcurrentAgents,
      context: {
        ...this.config.context,
        inceptionMessages: childInceptionMessages,
      },
      maxToolRoundsPerTurn:
        childConfig.maxRounds ?? this.config.maxToolRoundsPerTurn,
    });

    // Replace child's empty registry with the scoped one
    childHarness.registry = childRegistry;
    childHarness.abortSignal = abortController.signal;

    // Notify external code (orchestration tools) to register child-scoped tools
    // (e.g. spawn_agent closing over childHarness for grandchild support)
    if (depthAllowsOrchestration) {
      this.onChildCreated?.(childHarness);
    }

    // ── Register in orchestrator ────────────────────────────────────────────
    this.orchestrator.register({
      taskId: childId,
      parentTaskId: this.taskId,
      goal: childConfig.goal,
      depth: childDepth,
      startedAt: Date.now(),
      status: "running",
      abortController,
    });

    // ── Emit spawned event ──────────────────────────────────────────────────
    this.emitter.emit("subtask_spawned", {
      taskId: childId,
      parentTaskId: this.taskId,
      goal: childConfig.goal,
      depth: childDepth,
    });

    // ── Run child asynchronously ────────────────────────────────────────────
    const timeoutMs = childConfig.timeoutMs ?? 300_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const promise: Promise<SubtaskResult> = new Promise<SubtaskResult>(
      (resolve) => {
        // Set up timeout cancellation
        timeoutId = setTimeout(() => {
          this.orchestrator.cancel(childId);
        }, timeoutMs);

        childHarness
          .send(childConfig.goal)
          .then(() => {
            clearTimeout(timeoutId);
            const output = childHarness.getLastAssistantMessage();
            this.orchestrator.complete(childId, output);
            this.emitter.emit("subtask_complete", {
              taskId: childId,
              ok: true,
              output,
              rounds: childHarness.roundCount,
            });
            resolve({
              taskId: childId,
              ok: true,
              output,
              rounds: childHarness.roundCount,
            });
          })
          .catch((err: unknown) => {
            clearTimeout(timeoutId);
            const errMsg = err instanceof Error ? err.message : String(err);
            this.orchestrator.fail(childId, errMsg);
            this.emitter.emit("subtask_complete", {
              taskId: childId,
              ok: false,
              output: errMsg,
              rounds: childHarness.roundCount,
            });
            resolve({
              taskId: childId,
              ok: false,
              output: errMsg,
              rounds: childHarness.roundCount,
            });
          });
      }
    );

    return { taskId: childId, promise };
  }

  private async runReActLoop(round = 0): Promise<void> {
    // Check abort signal (set when orchestrator cancels this task)
    if (this.abortSignal?.aborted) return;

    if (round >= this.config.maxToolRoundsPerTurn) {
      this.emitter.emit("error", {
        err: new Error(
          `Max tool rounds (${this.config.maxToolRoundsPerTurn}) exceeded`
        ),
      });
      return;
    }

    this.roundCount = round + 1;

    // Context pressure alerts (#9): fire once per threshold per turn
    const snapBefore = this.context.snapshot();
    const pctBefore = Math.round(snapBefore.usageFraction * 100);
    if (pctBefore >= 85 && !this.contextAlertFired85) {
      this.contextAlertFired85 = true;
      this.context.appendMessage({
        role: "user",
        content: `[CONTEXT BUDGET CRITICAL: ${pctBefore}% used — call compress_context() immediately or early context will be lost.]`,
      });
    } else if (pctBefore >= 60 && !this.contextAlertFired60) {
      this.contextAlertFired60 = true;
      this.context.appendMessage({
        role: "user",
        content: `[CONTEXT BUDGET: ${pctBefore}% used — consider calling compress_context() before continuing long tasks.]`,
      });
    }

    const messages = this.context.buildMessages();
    const tools = this.registry.toOpenAIFormat();
    const accumulator = new StreamAccumulator();

    const stream = await this.streamWithRetry(messages, tools);

    let finishReason: string | null = null;

    for await (const chunk of stream) {
      // Check abort between chunks
      if (this.abortSignal?.aborted) return;

      const parsed = accumulator.processChunk(chunk);

      if (parsed.textDelta) {
        this.emitter.emit("text", { delta: parsed.textDelta });
      }

      if (parsed.toolCallDelta) {
        const { index, id, name, argsDelta } = parsed.toolCallDelta;

        if (parsed.isNewTool && id && name) {
          this.emitter.emit("tool_start", { callId: id, name });
        }

        if (argsDelta) {
          const tc = accumulator.accumulatedToolCalls[index];
          if (tc) {
            this.emitter.emit("tool_delta", { callId: tc.id, argsDelta });
          }
        }
      }

      if (parsed.finishReason) {
        finishReason = parsed.finishReason;
      }
    }

    const toolCalls = accumulator.accumulatedToolCalls;
    const assistantMessage = this.buildAssistantMessage(
      accumulator.accumulatedText,
      toolCalls
    );
    this.context.append(assistantMessage);

    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      // Collect tool names for pre-flight dangerLevel checks
      const batchToolNames = toolCalls.map((tc) => tc.name);

      const results = await Promise.all(
        toolCalls.map((tc) =>
          this.dispatcher.dispatch(tc.id, tc.name, tc.argsJson, batchToolNames)
        )
      );

      // Track tools used this turn (for recipe recording)
      for (const tc of toolCalls) {
        this.toolsUsedThisTurn.push(tc.name);
      }

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i] as AccumulatedToolCall;
        const result = results[i]!;
        this.context.append({
          role: "tool",
          tool_call_id: tc.id,
          content: result.ok ? result.output : `ERROR: ${result.error}`,
        });
      }

      // Per-tool error tracking + adaptive hints (#8)
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i] as AccumulatedToolCall;
        const result = results[i]!;
        if (!result.ok) {
          const prevCount = this.toolErrorCounts.get(tc.name) ?? 0;
          this.toolErrorCounts.set(tc.name, prevCount + 1);
          if (prevCount >= 1) {
            // Use unified error taxonomy hint (#9)
            this.context.appendMessage({
              role: "user",
              content: buildAdaptiveHint(tc.name, prevCount + 1),
            });
          }
        }
      }

      // Error recovery injection: if ALL tools failed, inject a structured hint + reflexion (#2)
      const allFailed = results.every((r) => !r.ok);
      if (allFailed) {
        const errorSummary = toolCalls
          .map((tc, i) => {
            const r = results[i]!;
            return `${tc.name}: ${!r.ok ? r.error : ""}`;
          })
          .join("; ");
        const hint = buildRecoveryHint(errorSummary);
        this.context.append({
          role: "user",
          content:
            `[SYSTEM NOTE] All tool calls in the last round failed.\n` +
            `Errors: ${errorSummary}\n` +
            `${hint}\n` +
            `Reassess and try a different approach — do NOT retry with identical arguments.`,
        });

        // Reflexion auto-persist (#2 VIGIL): awaited with error boundary — no silent swallowing
        if (this.registry.has("remember")) {
          const reflectionKey = `reflection:${hashString(this.lastUserMessage).slice(0, 12)}`;
          const reflectionValue =
            `[Round ${this.roundCount}] All tools failed. ` +
            `Errors: ${errorSummary.slice(0, 200)}. ` +
            `Task: ${this.lastUserMessage.slice(0, 80)}`;
          try {
            await this.dispatcher.directCall("remember", { key: reflectionKey, value: reflectionValue });
          } catch (err) {
            this.emitter.emit("text", {
              delta: `\n[HARNESS] Reflexion persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
            });
          }
        }
      }

      await this.runReActLoop(round + 1);
    } else {
      const snapshot = this.context.snapshot();
      this.emitter.emit("turn_end", { contextSnapshot: snapshot });
    }
  }

  private async streamWithRetry(
    messages: Message[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[]
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const useTools = tools.length > 0 && attempt < 2;
      const useToolChoice = useTools && attempt === 0;

      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: this.config.model,
        messages,
        stream: true,
        ...(useTools && { tools }),
        ...(useToolChoice && { tool_choice: "auto" as const }),
      };

      try {
        // Pass abort signal as RequestOptions (second arg) so hung streams can be cancelled (#3)
        return (await this.client.chat.completions.create(
          params,
          ...(this.abortSignal ? [{ signal: this.abortSignal }] : [])
        )) as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } catch (err) {
        lastErr = err;
        const msg = describeError(err);

        if (!isRetryable(err) || attempt === this.maxRetries) {
          throw new Error(msg);
        }

        const delay = this.retryDelayMs * Math.pow(2, attempt);
        this.emitter.emit("text", {
          delta: `\n⟳ ${msg} — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${this.maxRetries})…\n`,
        });

        await sleep(delay);
      }
    }

    throw new Error(describeError(lastErr));
  }

  private buildAssistantMessage(
    text: string,
    toolCalls: AccumulatedToolCall[]
  ): Message {
    if (toolCalls.length === 0) {
      return { role: "assistant", content: text || "" };
    }
    return {
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    };
  }

  reset(): void {
    this.context.clear();
    this.roundCount = 0;
  }
}
