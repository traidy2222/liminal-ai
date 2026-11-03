import type { ToolRegistry } from "./registry.js";

/** Explicit provider requests within an already-grounded local artifact action.
 * The caller supplies the artifact-action decision; provider words alone never
 * turn documentation, examples, or conceptual questions into tool executions.
 */
export function requestedArtifactConnectors(
  message: string,
  registry: ToolRegistry,
  artifactAction: boolean,
): string[] {
  if (!artifactAction) return [];
  const providers = new Set(
    registry
      .getToolNames()
      .map((name) => registry.getSuggestedFamilyForTool(name)?.split(":"))
      .filter((parts) => parts?.[0] === "connector")
      .map((parts) => parts![1]!)
      .filter(Boolean),
  );
  // Ignore quoted instructions/examples with whitespace; a quoted provider name
  // and quoted target path still leave the actual action outside that quotation.
  const instruction = message.replace(
    /(^|[\s:])(["'`])([^"'`\n]*\s[^"'`\n]*)\2/g,
    "$1 ",
  );
  return [...providers]
    .filter((name) => {
      const literal = name
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/_/g, "[ _-]");
      const token = `[\x60"']?${literal}[\x60"']?`;
      if (
        new RegExp(
          `\\b(?:without|avoid(?:\\s+using)?|do\\s+not\\s+use|don't\\s+use|no)\\s+(?:the\\s+)?${token}\\b`,
          "i",
        ).test(instruction)
      )
        return false;
      return new RegExp(
        `\\b(?:use|using|via|through|with)\\s+(?:the\\s+)?${token}\\b|\\b${token}\\s+(?:tools?|mcp|inspection|analysis|decompilation)\\b`,
        "i",
      ).test(instruction);
    })
    .sort();
}

export function missingArtifactConnectors(
  requested: readonly string[],
  toolsUsed: readonly string[],
  registry: ToolRegistry,
): string[] {
  const attempted = new Set(
    toolsUsed
      .map((name) => registry.getSuggestedFamilyForTool(name)?.split(":"))
      .filter((parts) => parts?.[0] === "connector")
      .map((parts) => parts![1]),
  );
  return requested.filter((name) => !attempted.has(name));
}
