import type OpenAI from "openai";
import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  /** When true, only tools in activeToolNames are sent to the model API. */
  private lazyToolLoading = false;
  private readonly activeToolNames = new Set<string>();
  /** Optional tool name -> family id (for inactive-tool error hints). */
  private toolFamilyByName = new Map<string, string>();

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

  /** Remove a tool from the registry; returns true if it existed. */
  unregister(name: string): boolean {
    const existed = this.tools.has(name);
    this.tools.delete(name);
    this.activeToolNames.delete(name);
    this.toolFamilyByName.delete(name);
    return existed;
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

  /** Tool names currently registered (stable order). */
  getToolNames(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** When lazy loading is off, all registered tools are active. */
  isLazyToolLoading(): boolean {
    return this.lazyToolLoading;
  }

  setLazyToolLoading(enabled: boolean): void {
    this.lazyToolLoading = enabled;
    if (!enabled) {
      this.activeToolNames.clear();
    }
  }

  setToolFamilyLookup(map: ReadonlyMap<string, string>): void {
    this.toolFamilyByName = new Map(map);
  }

  /** Copy family map from another registry (e.g. parent → child). */
  copyToolFamiliesFrom(source: ToolRegistry): void {
    this.toolFamilyByName = source.cloneToolFamilyMap();
  }

  cloneToolFamilyMap(): Map<string, string> {
    return new Map(this.toolFamilyByName);
  }

  getSuggestedFamilyForTool(name: string): string | undefined {
    return this.toolFamilyByName.get(name);
  }

  /** Active-family summary derived from tool->family mapping (for prompt/status snapshots). */
  getActiveFamilySummary(limit = 6): Array<{ family: string; active: number; total: number }> {
    const counts = new Map<string, { active: number; total: number }>();
    for (const [tool, family] of this.toolFamilyByName.entries()) {
      if (!this.tools.has(tool)) continue;
      const row = counts.get(family) ?? { active: 0, total: 0 };
      row.total += 1;
      if (this.isActive(tool)) row.active += 1;
      counts.set(family, row);
    }
    return [...counts.entries()]
      .map(([family, c]) => ({ family, active: c.active, total: c.total }))
      .filter((r) => r.total > 0)
      .sort((a, b) => (b.active - a.active) || (a.family < b.family ? -1 : 1))
      .slice(0, Math.max(1, limit));
  }

  /**
   * Sync lazy policy from parent after child registry is populated.
   * Child active set = intersection(parent active, child registered names).
   */
  copyLazyPolicyFromParent(parent: ToolRegistry): void {
    this.lazyToolLoading = parent.lazyToolLoading;
    this.copyToolFamiliesFrom(parent);
    if (!parent.lazyToolLoading) {
      this.activeToolNames.clear();
      return;
    }
    const childNames = new Set(this.getToolNames());
    const seed = parent.getActiveToolNames().filter((n) => childNames.has(n));
    this.seedActiveTools(seed);
  }

  isActive(name: string): boolean {
    if (!this.lazyToolLoading) return true;
    return this.activeToolNames.has(name);
  }

  /** Names of tools currently exposed to the model (lazy) or all (non-lazy). */
  getActiveToolNames(): string[] {
    if (!this.lazyToolLoading) return this.getToolNames();
    return [...this.activeToolNames].sort();
  }

  /** Replace active set (lazy mode only). */
  seedActiveTools(names: string[]): void {
    if (!this.lazyToolLoading) return;
    this.activeToolNames.clear();
    for (const n of names) {
      if (this.tools.has(n)) this.activeToolNames.add(n);
    }
  }

  /** Add tools to active set; returns names that were newly activated. */
  activate(names: readonly string[]): string[] {
    if (!this.lazyToolLoading) return [];
    const newly: string[] = [];
    for (const n of names) {
      if (!this.tools.has(n)) continue;
      if (!this.activeToolNames.has(n)) {
        this.activeToolNames.add(n);
        newly.push(n);
      }
    }
    return newly;
  }

  toOpenAIFormat(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const defs = !this.lazyToolLoading
      ? this.getAll()
      : [...this.activeToolNames]
          .sort()
          .map((n) => this.tools.get(n))
          .filter((t): t is ToolDefinition => t !== undefined);
    return defs.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as OpenAI.FunctionParameters,
      },
    }));
  }
}
