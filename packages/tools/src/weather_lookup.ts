import { effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { fetchWeather } from "./weather_fetch.js";

export const weatherLookupTool = defineTool({
  name: "weather_lookup",
  description:
    "WHAT: Resolve a place and return current weather with deterministic fallback (nearest station/town/hub) and freshness metadata.\n" +
    "WHEN: User asks for weather 'right now/currently/live' for a place, especially small or ambiguous localities.\n" +
    "DISAMBIGUATION: ambiguous names auto-bias toward the user's own region (from world context / AGENT_LOCATION) so e.g. 'Grantham' resolves locally, not to the largest foreign homonym. Pass country_hint only to FORCE a specific country.\n" +
    "ARGS: location (required), optional country_hint (ISO2), units (metric|imperial), prefer_live (default true).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", minLength: 2, maxLength: 160, description: "Place name to resolve" },
      country_hint: { type: "string", minLength: 2, maxLength: 2, description: "Optional ISO-2 country code" },
      units: { type: "string", enum: ["metric", "imperial"], description: "Output units (default metric)" },
      prefer_live: {
        type: "boolean",
        description: "When true, prefer freshest current observations and expose fallback details",
      },
    },
    required: ["location"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const location = String(args["location"] ?? "").trim();
    emit?.(`\nweather_lookup: geocoding "${location}"…\n`);
    const countryHint = (args["country_hint"] as string | undefined)?.trim();
    const units = (args["units"] as "metric" | "imperial" | undefined) ?? "metric";
    const preferLive = (args["prefer_live"] as boolean | undefined) ?? true;
    // Soft home-region bias from world context so ambiguous names resolve
    // locally. Only used when the caller did not force a country_hint.
    const homeLocation = countryHint ? undefined : effectiveHarnessEnvRaw("AGENT_LOCATION")?.trim();
    try {
      const result = await fetchWeather(
        {
          location,
          country_hint: countryHint,
          home_location: homeLocation,
          units,
          prefer_live: preferLive,
        },
        (line) => emit?.(`  → ${line}\n`)
      );
      return { ok: true, output: JSON.stringify(result, null, 2) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
