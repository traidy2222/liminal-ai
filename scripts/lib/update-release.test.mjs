import assert from "node:assert/strict";
import {
  compareSemver,
  compareVersions,
  isVersionLess,
  normalizeVersion,
} from "./update-release.mjs";
import { parseSha256Sidecar } from "../generate-desktop-manifest.mjs";
import {
  desktopArtifactFileName,
  liminaldRuntimeFileName,
} from "./desktop-release-names.mjs";

function testCompareSemver() {
  assert.ok(compareSemver("0.1.0", "0.1.1") < 0);
  assert.ok(compareSemver("1.0.0", "0.9.9") > 0);
  assert.equal(compareSemver("0.1.0", "0.1.0"), 0);
  assert.equal(isVersionLess("0.1.0", "0.2.0"), true);
  assert.equal(normalizeVersion("v0.1.0"), "0.1.0");
}

function testCompareVersions() {
  const both = compareVersions({
    appVersion: "0.1.0",
    harnessVersion: "0.1.0",
    latestVersion: "0.2.0",
  });
  assert.equal(both.appUpdate, true);
  assert.equal(both.harnessUpdate, true);

  const harnessOnly = compareVersions({
    appVersion: "0.2.0",
    harnessVersion: "0.1.0",
    latestVersion: "0.2.0",
  });
  assert.equal(harnessOnly.appUpdate, false);
  assert.equal(harnessOnly.harnessUpdate, true);
}

function testParseSha256() {
  const hash = "a".repeat(64);
  assert.equal(parseSha256Sidecar(`${hash}  file.zip`), hash);
}

function testArtifactNames() {
  assert.equal(
    desktopArtifactFileName("windows", "0.1.0"),
    "liminal-desktop-windows-x64-v0.1.0.zip",
  );
  assert.equal(liminaldRuntimeFileName("0.1.0"), "liminald-runtime-v0.1.0.zip");
}

testCompareSemver();
testCompareVersions();
testParseSha256();
testArtifactNames();
console.log("update-release.test.mjs: ok");
