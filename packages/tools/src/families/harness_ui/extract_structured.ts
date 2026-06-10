/**
 * extract_structured — extract structured JSON from unstructured text via LLM.
 *
 * Makes a focused single-call extraction using the harness model.
 * Useful for: parsing API responses, extracting table data from HTML,
 * turning unstructured notes into typed entities, structuring log output.
 */
import type { AgentHarness } from "@liminal/core";
import { withProviderRequestSpacing, effectiveHarnessEnvRaw, buildOpenRouterAttributionHeaders } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

export function createExtractStructuredTool(harness: AgentHarness) {
  return defineTool({
    name: "extract_structured",
    description:
      "WHAT: Extract structured JSON data from unstructured text using the LLM.\n" +
      "WHEN: Parsing API docs, extracting table rows from HTML, structuring log output, turning free text into typed data.\n" +
      "NOT WHEN: The text is already JSON — parse it directly. NOT for large (>4000 char) texts — chunk first.\n" +
      "ARGS: content — the text to extract from; " +
      "schema_description — describe the JSON structure you want (e.g. '{ name: string, version: string, description: string }'); " +
      "example — optional example output to guide extraction.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Text to extract structured data from" },
        schema_description: {
          type: "string",
          description: "Description of the desired JSON structure",
        },
        example: {
          type: "string",
          description: "Optional example of the expected output format",
        },
      },
      required: ["content", "schema_description"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const content = args["content"] as string;
      const schemaDesc = args["schema_description"] as string;
      const example = args["example"] as string | undefined;

      const { openRouterApiKey, model, baseURL } = harness.config;
      if (!openRouterApiKey) {
        return { ok: false, error: "Cannot extract: OPENROUTER_API_KEY not configured." };
      }

      const exampleBlock = example ? `\nExample output:\n${example}` : "";
      const prompt =
        `Extract structured JSON from the following text.\n\n` +
        `DESIRED SCHEMA: ${schemaDesc}${exampleBlock}\n\n` +
        `OUTPUT RULES:\n` +
        `- Return ONLY valid JSON — no markdown, no explanation, no code fences\n` +
        `- If a field cannot be extracted, use null\n` +
        `- If the content describes multiple items, return an array\n\n` +
        `TEXT TO EXTRACT FROM:\n${content.slice(0, 4000)}${content.length > 4000 ? "\n[truncated]" : ""}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await withProviderRequestSpacing(
          { apiKey: openRouterApiKey, baseURL },
          () =>
            fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openRouterApiKey}`,
                ...buildOpenRouterAttributionHeaders(),
              },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: "system",
                    content: "You are a precise JSON extractor. Output only valid JSON, nothing else.",
                  },
                  { role: "user", content: prompt },
                ],
                max_tokens: 1000,
                temperature: 0,
                stream: false,
              }),
              signal: controller.signal,
            })
        );

        if (!response.ok) {
          return { ok: false, error: `Extraction API returned HTTP ${response.status}` };
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

        // Strip markdown code fences if the model wrapped its response
        const stripped = raw
          .replace(/^```(?:json|JSON)?\s*\r?\n?/, "")
          .replace(/\r?\n?```\s*$/, "")
          .trim();

        // Attempt 1: parse the whole stripped response (model followed instructions)
        try {
          JSON.parse(stripped);
          return { ok: true, output: stripped };
        } catch {
          // fall through to structured extraction
        }

        // Attempt 2: walk from the first { or [ and find the matching closer,
        // respecting string escaping so we don't confuse delimiters inside strings.
        const start = Math.min(
          ...[stripped.indexOf("{"), stripped.indexOf("[")].filter((i) => i >= 0)
        );
        if (!Number.isFinite(start)) {
          return { ok: false, error: `No JSON found in extraction response. Raw: ${raw.slice(0, 200)}` };
        }
        const opener = stripped[start]!;
        const closer = opener === "{" ? "}" : "]";
        let depth = 0;
        let inStr = false;
        let escaped = false;
        let end = -1;
        for (let i = start; i < stripped.length; i++) {
          const c = stripped[i]!;
          if (escaped) { escaped = false; continue; }
          if (c === "\\" && inStr) { escaped = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === opener) depth++;
          else if (c === closer && --depth === 0) { end = i; break; }
        }
        if (end === -1) {
          return { ok: false, error: `Unbalanced JSON structure in extraction response. Raw: ${raw.slice(0, 200)}` };
        }
        const candidate = stripped.slice(start, end + 1);
        try {
          JSON.parse(candidate);
          return { ok: true, output: candidate };
        } catch (e) {
          return { ok: false, error: `Extracted content is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          return { ok: false, error: `Extracted content is not valid JSON: ${err.message}` };
        }
        return { ok: false, error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  });
}
