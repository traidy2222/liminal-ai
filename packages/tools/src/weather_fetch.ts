/**
 * Shared weather fetch (Open-Meteo) — used by weather_lookup tool and liminal app refresh.
 */

export type GeoResult = {
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
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
};

type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  timezone?: string;
  current?: CurrentPayload;
};

export const WEATHER_CODE_MAP: Record<number, string> = {
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

export interface WeatherFetchInput {
  location: string;
  country_hint?: string;
  /**
   * The user's own region as free text (e.g. "Brisbane, Australia" from
   * AGENT_LOCATION / world context). Used as a *soft* bias so an ambiguous
   * place name resolves to the local homonym; never hard-filters results.
   */
  home_location?: string;
  units?: "metric" | "imperial";
  prefer_live?: boolean;
}

export interface WeatherFetchResult {
  resolved_location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string | null;
    country_code: string | null;
  };
  alternates: Array<{
    name: string;
    latitude: number;
    longitude: number;
    population: number | null;
  }>;
  fallback_level: "primary_locality" | "nearest_station" | "major_town" | "regional_hub";
  distance_km: number;
  is_live: boolean;
  observed_at: string | null;
  source: string;
  freshness_minutes: number;
  conditions: string;
  temperature: {
    value: number | null;
    apparent: number | null;
    units: string;
  };
  wind: {
    speed: number | null;
    direction: number | null;
    gust: number | null;
    speed_units: string;
  };
  precip: {
    precipitation: number | null;
    rain: number | null;
    showers: number | null;
    snowfall: number | null;
    units: string;
  };
  confidence: "high" | "medium" | "low";
  uncertainty_note: string;
}

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

/** Soft bias toward the user's own region (from world context / AGENT_LOCATION). */
export interface HomeBias {
  country_code?: string;
  latitude?: number;
  longitude?: number;
}

export interface CandidateScoreOpts {
  /** Explicit ISO-2 country supplied by the caller (strongest signal). */
  countryHint?: string;
  /** The user's home region — a soft tiebreaker so a local homonym wins. */
  home?: HomeBias;
}

export function scoreCandidate(g: GeoResult, opts: CandidateScoreOpts = {}): number {
  const { countryHint, home } = opts;
  let score = 0;
  if (countryHint && g.country_code?.toLowerCase() === countryHint.toLowerCase()) score += 30;
  // Soft home-region bias: a same-country homonym (e.g. Grantham, QLD for an
  // Australian user) outranks a larger foreign one, but a genuinely foreign
  // request (Tokyo) is never excluded — this only adds, never filters.
  if (home?.country_code && g.country_code?.toLowerCase() === home.country_code.toLowerCase()) {
    score += 26;
  }
  if (
    home?.latitude !== undefined &&
    home?.longitude !== undefined &&
    Number.isFinite(g.latitude) &&
    Number.isFinite(g.longitude)
  ) {
    const dist = haversineKm(home.latitude, home.longitude, g.latitude, g.longitude);
    // Up to +12 for very near home, decaying to 0 by ~3000 km.
    score += Math.max(0, 12 * (1 - Math.min(dist, 3000) / 3000));
  }
  if (g.population && g.population > 0) score += Math.min(20, Math.log10(g.population) * 2.5);
  if (g.feature_code?.startsWith("PPL")) score += 12;
  if (g.timezone) score += 3;
  return score;
}

/** Rank geocode candidates best-first under the given hints. Pure + testable. */
export function rankWeatherCandidates(
  candidates: GeoResult[],
  opts: CandidateScoreOpts = {}
): GeoResult[] {
  return [...candidates].sort((a, b) => scoreCandidate(b, opts) - scoreCandidate(a, opts));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
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

function fallbackLabel(level: number): WeatherFetchResult["fallback_level"] {
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

export type WeatherFetchProgress = (line: string) => void;

export async function fetchWeather(
  input: WeatherFetchInput,
  onProgress?: WeatherFetchProgress
): Promise<WeatherFetchResult> {
  const location = input.location.trim();
  const countryHint = input.country_hint?.trim();
  const homeLocation = input.home_location?.trim();
  const units = input.units ?? "metric";
  const preferLive = input.prefer_live ?? true;

  // Resolve the user's home region into a soft bias when no explicit country
  // hint was given. Best-effort: a failed/empty home geocode just means no bias.
  let home: HomeBias | undefined;
  if (!countryHint && homeLocation) {
    try {
      const homeGeo = (await geocode(homeLocation, 1))[0];
      if (homeGeo) {
        home = {
          country_code: homeGeo.country_code,
          latitude: homeGeo.latitude,
          longitude: homeGeo.longitude,
        };
        onProgress?.(`home region: ${buildDisplayName(homeGeo)} (${homeGeo.country_code ?? "?"})`);
      }
    } catch {
      /* no home bias */
    }
  }

  onProgress?.(`geocoding "${location}"…`);
  const candidates = await geocode(location, 12, countryHint);
  if (candidates.length === 0) {
    throw new Error(`No location candidates found for "${location}".`);
  }

  const scoreOpts: CandidateScoreOpts = { countryHint, home };
  const ranked = rankWeatherCandidates(candidates, scoreOpts);
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
  const hubCandidates = regionalHubQuery ? await geocode(regionalHubQuery, 3, primary.country_code) : [];
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
    if (i > 0) onProgress?.(`fallback ${i}: ${c.name ?? c.admin1 ?? "unknown"}`);
    else onProgress?.(`fetching ${c.name ?? location}`);
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
    throw new Error(`Weather lookup failed for "${location}": ${lastErr || "no fallback succeeded"}`);
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

  return {
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
}
