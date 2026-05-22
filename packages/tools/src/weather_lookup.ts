import { defineTool } from "./helpers.js";

type GeoResult = {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  population?: number;
  feature_code?: string;
};

type OpenMeteoGeocodeResponse = {
  results?: GeoResult[];
};

type CurrentPayload = {
  time?: string;
  interval?: number;
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
  weather_code?: number;
  cloud_cover?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  is_day?: number;
};

type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  elevation?: number;
  current?: CurrentPayload;
};

const WEATHER_CODE_MAP: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function buildDisplayName(g: GeoResult): string {
  return [g.name, g.admin1, g.country].filter(Boolean).join(", ");
}

function scoreCandidate(g: GeoResult, countryHint?: string): number {
  let score = 0;
  if (countryHint && g.country_code?.toLowerCase() === countryHint.toLowerCase()) score += 30;
  if (g.population && g.population > 0) score += Math.min(20, Math.log10(g.population) * 2.5);
  if (g.feature_code?.startsWith("PPL")) score += 12;
  if (g.timezone) score += 3;
  return score;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function geocode(location: string, count: number, countryHint?: string): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    name: location,
    count: String(count),
    language: "en",
    format: "json",
  });
  if (countryHint) params.set("countryCode", countryHint.toUpperCase());
  const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
  const data = await fetchJson<OpenMeteoGeocodeResponse>(url);
  return data.results ?? [];
}

async function fetchCurrent(g: GeoResult, units: "metric" | "imperial"): Promise<OpenMeteoForecastResponse> {
  const params = new URLSearchParams({
    latitude: String(g.latitude),
    longitude: String(g.longitude),
    timezone: "auto",
    forecast_days: "1",
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
  });
  if (units === "imperial") {
    params.set("temperature_unit", "fahrenheit");
    params.set("wind_speed_unit", "mph");
    params.set("precipitation_unit", "inch");
  }
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  return fetchJson<OpenMeteoForecastResponse>(url);
}

function fallbackLabel(level: number): "primary_locality" | "nearest_station" | "major_town" | "regional_hub" {
  if (level === 0) return "primary_locality";
  if (level === 1) return "nearest_station";
  if (level === 2) return "major_town";
  return "regional_hub";
}

function toConfidence(level: number, freshnessMinutes: number): "high" | "medium" | "low" {
  if (level === 0 && freshnessMinutes <= 90) return "high";
  if (level <= 2 && freshnessMinutes <= 240) return "medium";
  return "low";
}

export const weatherLookupTool = defineTool({
  name: "weather_lookup",
  description:
    "WHAT: Resolve a place and return current weather with deterministic fallback (nearest station/town/hub) and freshness metadata.\n" +
    "WHEN: User asks for weather 'right now/currently/live' for a place, especially small or ambiguous localities.\n" +
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
    const units = ((args["units"] as "metric" | "imperial" | undefined) ?? "metric");
    const preferLive = (args["prefer_live"] as boolean | undefined) ?? true;
    try {
      const candidates = await geocode(location, 12, countryHint);
      if (candidates.length === 0) return { ok: false, error: `No location candidates found for "${location}".` };

      const ranked = [...candidates].sort(
        (a, b) => scoreCandidate(b, countryHint) - scoreCandidate(a, countryHint)
      );
      const primary = ranked[0]!;

      const nearestByDistance = [...ranked]
        .slice(1)
        .sort(
          (a, b) =>
            haversineKm(primary.latitude, primary.longitude, a.latitude, a.longitude) -
            haversineKm(primary.latitude, primary.longitude, b.latitude, b.longitude)
        );
      const majorTown = [...ranked]
        .filter((g) => (g.population ?? 0) >= 20_000)
        .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];

      const regionalHubQuery = [primary.admin1, primary.country, "airport"].filter(Boolean).join(" ");
      const hubCandidates = regionalHubQuery
        ? await geocode(regionalHubQuery, 3, primary.country_code)
        : [];
      const regionalHub = hubCandidates[0];

      const fallbackOrder: Array<GeoResult | undefined> = [
        primary,
        nearestByDistance[0],
        majorTown,
        regionalHub,
      ];

      let selected: GeoResult | null = null;
      let selectedCurrent: OpenMeteoForecastResponse | null = null;
      let level = 0;
      let lastErr = "";

      for (let i = 0; i < fallbackOrder.length; i++) {
        const c = fallbackOrder[i];
        if (!c) continue;
        if (i > 0) emit?.(`  → fallback ${i}: ${c.name ?? c.admin1 ?? "unknown"}\n`);
        else emit?.(`  → fetching ${c.name ?? location}\n`);
        try {
          const cur = await fetchCurrent(c, units);
          if (cur.current?.time || !preferLive) {
            selected = c;
            selectedCurrent = cur;
            level = i;
            break;
          }
          lastErr = "No current observation payload.";
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }

      if (!selected || !selectedCurrent) {
        return { ok: false, error: `Weather lookup failed for "${location}": ${lastErr || "no fallback succeeded"}` };
      }

      const observedAtIso = selectedCurrent.current?.time ?? "";
      const observedAt = observedAtIso ? new Date(observedAtIso).getTime() : NaN;
      const freshnessMinutes = Number.isFinite(observedAt)
        ? Math.max(0, Math.round((Date.now() - observedAt) / 60_000))
        : 9999;
      const isLive = Number.isFinite(observedAt) && freshnessMinutes <= 180;
      const primaryDistanceKm = haversineKm(
        primary.latitude,
        primary.longitude,
        selected.latitude,
        selected.longitude
      );

      const result = {
        resolved_location: {
          name: buildDisplayName(selected),
          latitude: selected.latitude,
          longitude: selected.longitude,
          timezone: selectedCurrent.timezone ?? selected.timezone ?? null,
          country_code: selected.country_code ?? null,
        },
        alternates: ranked.slice(0, 4).map((g) => ({
          name: buildDisplayName(g),
          latitude: g.latitude,
          longitude: g.longitude,
          population: g.population ?? null,
        })),
        fallback_level: fallbackLabel(level),
        distance_km: Number(primaryDistanceKm.toFixed(1)),
        is_live: isLive,
        observed_at: observedAtIso || null,
        source: "open-meteo (geocoding-api + forecast current)",
        freshness_minutes: freshnessMinutes,
        conditions: WEATHER_CODE_MAP[selectedCurrent.current?.weather_code ?? -1] ?? "Unknown",
        temperature: {
          value: selectedCurrent.current?.temperature_2m ?? null,
          apparent: selectedCurrent.current?.apparent_temperature ?? null,
          units: units === "imperial" ? "F" : "C",
        },
        wind: {
          speed: selectedCurrent.current?.wind_speed_10m ?? null,
          direction: selectedCurrent.current?.wind_direction_10m ?? null,
          gust: selectedCurrent.current?.wind_gusts_10m ?? null,
          speed_units: units === "imperial" ? "mph" : "km/h",
        },
        precip: {
          precipitation: selectedCurrent.current?.precipitation ?? null,
          rain: selectedCurrent.current?.rain ?? null,
          showers: selectedCurrent.current?.showers ?? null,
          snowfall: selectedCurrent.current?.snowfall ?? null,
          units: units === "imperial" ? "in" : "mm",
        },
        confidence: toConfidence(level, freshnessMinutes),
        uncertainty_note: isLive
          ? "Current reading appears fresh."
          : "Live reading freshness is limited; use as estimate and disclose as-of timestamp.",
      };

      return { ok: true, output: JSON.stringify(result, null, 2) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
