import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, rankWeatherCandidates, type GeoResult } from "./weather_fetch.js";

const granthamEngland: GeoResult = {
  name: "Grantham",
  latitude: 52.91,
  longitude: -0.64,
  country: "United Kingdom",
  country_code: "GB",
  admin1: "England",
  population: 44580,
  feature_code: "PPL",
  timezone: "Europe/London",
};

const granthamAU: GeoResult = {
  name: "Grantham",
  latitude: -27.59,
  longitude: 152.2,
  country: "Australia",
  country_code: "AU",
  admin1: "Queensland",
  population: 370,
  feature_code: "PPL",
  timezone: "Australia/Brisbane",
};

const tokyo: GeoResult = {
  name: "Tokyo",
  latitude: 35.68,
  longitude: 139.69,
  country: "Japan",
  country_code: "JP",
  admin1: "Tokyo",
  population: 8336599,
  feature_code: "PPLC",
  timezone: "Asia/Tokyo",
};

test("without bias, the larger foreign homonym wins (documents the old behavior)", () => {
  const ranked = rankWeatherCandidates([granthamAU, granthamEngland]);
  assert.equal(ranked[0]!.country_code, "GB");
});

test("home-region bias makes the local homonym win (the reported bug)", () => {
  const ranked = rankWeatherCandidates([granthamEngland, granthamAU], {
    home: { country_code: "AU", latitude: -27.47, longitude: 153.02 },
  });
  assert.equal(ranked[0]!.country_code, "AU", "Grantham should resolve to Queensland for an AU user");
});

test("country match dominates population even by itself", () => {
  const withHome = scoreCandidate(granthamAU, { home: { country_code: "AU" } });
  const foreign = scoreCandidate(granthamEngland, { home: { country_code: "AU" } });
  assert.ok(withHome > foreign);
});

test("soft bias never excludes a genuine foreign request", () => {
  // User in Australia asks for Tokyo — the only Tokyo candidate still wins.
  const ranked = rankWeatherCandidates([tokyo], {
    home: { country_code: "AU", latitude: -27.47, longitude: 153.02 },
  });
  assert.equal(ranked[0]!.name, "Tokyo");
});

test("explicit country_hint still outranks home bias", () => {
  // Caller forces GB even though home is AU.
  const ranked = rankWeatherCandidates([granthamAU, granthamEngland], {
    countryHint: "GB",
    home: { country_code: "AU" },
  });
  assert.equal(ranked[0]!.country_code, "GB");
});
