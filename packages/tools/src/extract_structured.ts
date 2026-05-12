/**
 * extract_structured — extract structured JSON from unstructured text via LLM.
 *
 * Makes a focused single-call extraction using the harness model.
 * Useful for: parsing API responses, extracting table data from HTML,
 * turning unstructured notes into typed entities, structuring log output.
 */
import type { AgentHarness } from "@liminal/core";
import { withProviderRequestSpacing } from "@liminal/core";
import { defineTool } from "./helpers.js";

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
                "HTTP-Referer": "https://github.com/liminal-ai",
                "X-Title": "Liminal",
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

        // Strip markdown fences if present
        const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!jsonMatch) {
          return { ok: false, error: `No JSON found in extraction response. Raw: ${raw.slice(0, 200)}` };
        }

        // Validate it's parseable
        JSON.parse(jsonMatch[0]);
        return { ok: true, output: jsonMatch[0] };
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
