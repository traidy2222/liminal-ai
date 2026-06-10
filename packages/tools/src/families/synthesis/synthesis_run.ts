/**
 * synthesis_run — harness-scoped weekly cross-domain synthesis sub-agent.
 *
 * Forks a child agent with vault + memory tools, which:
 *   1. Reads recent vault notes from distinct domains
 *   2. Forces connections between them (Hormuz → supply chain → tech, etc.)
 *   3. Writes a synthesis note to the vault
 *
 * Runs synchronously (awaits the child) so the result is returned in the same turn.
 * After completing, call schedule_run('weekly_synthesis') to reset the clock.
 */

import type { ToolDefinition, AgentHarness } from "@liminal/core";

const SYNTHESIS_SYSTEM_PROMPT = `You are a cross-domain synthesis analyst. Your sole task:

1. Use vault_list to find note categories/domains present in the vault.
2. Use vault_search or recall_relevant to pull 4-8 recent substantive notes from AT LEAST 3 different domains.
3. Use think() to force connections — what does note A imply about topic B? What do these domains share?
4. Write ONE synthesis note to the vault titled "Synthesis — <date>/<theme>" that:
   - Names the domains spanned
   - States 3-5 non-obvious cross-domain connections
   - Ends with 2-3 open questions or action items that follow from the synthesis
5. Return a one-paragraph summary of what you found.

Be specific. Cross-domain connections are the whole point — avoid generic observations.
Output format: JSON { ok: true, summary: "...", vault_note: "title" }`;

export function createSynthesisRunTool(harness: AgentHarness): ToolDefinition {
  return {
    name: "synthesis_run",
    requiresApproval: false,
    description:
      "Run a weekly cross-domain synthesis: reads recent vault notes across different domains, " +
      "forces connections between them, and writes a synthesis note to the vault. " +
      "Runs a dedicated sub-agent — takes 1-3 minutes. " +
      "Call schedule_run('weekly_synthesis') afterwards to reset the recurrence clock.",
    parameters: {
      type: "object",
      properties: {
        theme_hint: {
          type: "string",
          description:
            "Optional theme or domain to anchor the synthesis (e.g. 'geopolitics + AI supply chain'). " +
            "If omitted, the sub-agent picks connections freely.",
        },
        max_notes: {
          type: "number",
          description: "Max vault notes to read (default 8, capped at 20).",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args) => {
      const themeHint = (args["theme_hint"] as string | undefined) ?? "";
      const maxNotes = Math.min((args["max_notes"] as number | undefined) ?? 8, 20);

      const today = new Date().toISOString().slice(0, 10);

      const userPrompt =
        `Today is ${today}. ` +
        (themeHint ? `Theme anchor: ${themeHint}. ` : "") +
        `Read up to ${maxNotes} recent vault notes spanning at least 3 different domains. ` +
        `Find the non-obvious connections. Write a synthesis vault note titled "Synthesis — ${today}" ` +
        `(or use a specific theme in the title if one emerges). ` +
        `Return JSON { ok: true, summary: "...", vault_note: "<title>" }.`;

      const { promise } = harness.forkChild({
        goal: `Cross-domain synthesis run — ${today}${themeHint ? ` (${themeHint})` : ""}`,
        activateTools: [
          "vault_list",
          "vault_search",
          "vault_read",
          "vault_write",
          "recall_relevant",
          "search_memory",
          "think",
        ],
        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
        userPrompt,
        maxRounds: 20,
        timeoutMs: 180_000,
      });

      const r = await promise;

      if (!r.ok) {
        return {
          ok: false,
          error: `Synthesis sub-agent failed: ${r.output}`,
        };
      }

      // Try to parse JSON output; fall back to raw text
      let summary = r.output;
      let vaultNote: string | undefined;
      try {
        const parsed = JSON.parse(r.output) as { ok?: boolean; summary?: string; vault_note?: string };
        if (parsed.summary) summary = parsed.summary;
        if (parsed.vault_note) vaultNote = parsed.vault_note;
      } catch { /* sub-agent returned prose — that's fine */ }

      return {
        ok: true,
        output:
          `Synthesis complete.\n\n${summary}` +
          (vaultNote ? `\n\nVault note written: [[${vaultNote}]]` : "") +
          `\n\nCall schedule_run('weekly_synthesis') to reset the recurrence clock.`,
      };
    },
  };
}
