import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAppSpecFromSpawn,
  defaultAppId,
  sanitizeAppId,
  validateAppProps,
  validateWeatherAppProps,
} from "./app_spec.js";

describe("liminal_apps app_spec", () => {
  it("sanitizes app ids", () => {
    assert.equal(sanitizeAppId("  Weather Home!  "), "weather_home");
    assert.equal(defaultAppId("weather", "Grantham"), "weather_grantham");
  });

  it("validates weather props", () => {
    const ok = validateWeatherAppProps({ location: "Grantham, UK", units: "metric" });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.props.location, "Grantham, UK");

    const bad = validateWeatherAppProps({ location: "x" });
    assert.equal(bad.ok, false);
  });

  it("builds spawn spec", () => {
    const built = buildAppSpecFromSpawn({
      type: "weather",
      props: { location: "London" },
      title: "London weather",
    });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.equal(built.spec.type, "weather");
      assert.equal(built.spec.title, "London weather");
      assert.ok(built.spec.refresh?.interval_min);
      assert.equal(built.spec.shell?.mode, "widget");
      assert.equal(built.spec.shell?.frameless, true);
      assert.equal(built.spec.shell?.always_on_top, false);
      assert.equal(built.spec.placement?.width, 300);
    }
  });

  it("normalizes shell on spawn", () => {
    const built = buildAppSpecFromSpawn({
      type: "html",
      props: { html: "<p>x</p>" },
      shell: { mode: "window" },
    });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.equal(built.spec.shell?.mode, "window");
      assert.equal(built.spec.shell?.frameless, false);
    }
  });

  it("validates html widget props", () => {
    const ok = validateAppProps("html", {
      html: "<main><h1>Hi</h1></main>",
      interactivity: "sandbox",
    });
    assert.equal(ok.ok, true);

    const bad = validateAppProps("html", { interactivity: "sandbox" });
    assert.equal(bad.ok, false);
  });

  it("builds html spawn spec", () => {
    const built = buildAppSpecFromSpawn({
      type: "html",
      props: { html: "<p>widget</p>" },
      title: "Widget",
    });
    assert.equal(built.ok, true);
    if (built.ok) assert.equal(built.spec.type, "html");
  });
});
