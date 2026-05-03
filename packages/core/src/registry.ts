import type OpenAI from "openai";
import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Replace an existing tool definition without throwing on duplicate.
   * Used by the eval package for mock injection. (#10 Eval Infrastructure)
   */
  replace(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  toOpenAIFormat(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.getAll().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as OpenAI.FunctionParameters,
      },
    }));
  }
}
