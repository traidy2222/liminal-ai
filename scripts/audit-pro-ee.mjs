#!/usr/bin/env node
/**
 * Audit Pro + Enterprise Edition stack (local + production smoke).
 * Usage: node scripts/audit-pro-ee.mjs [--production]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const production = process.argv.includes("--production");
const site = (process.env.AGENT_VIREON_SITE_URL ?? "https://www.vireondynamics.com").replace(/\/$/, "");

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n=== Pro / EE audit ===\n");

  // 1. Builds
  for (const pkg of ["packages/core", "packages/tools", "packages/enterprise"]) {
    const distEntry = path.join(root, pkg, "dist", "index.js");
    if (existsSync(distEntry)) {
      pass(`build:${pkg}`, "dist/index.js present");
    } else {
      fail(`build:${pkg}`, "missing dist/index.js — run npm run build");
    }
  }

  // 2. Core loader exports
  const coreIndex = path.join(root, "packages/core/dist/index.js");
  if (existsSync(coreIndex)) {
    const core = await import(pathToFile(coreIndex));
    for (const fn of [
      "loadEnterpriseModule",
      "wireEnterpriseEdition",
      "wireEnterpriseWithInstall",
      "ensureEnterpriseEditionInstalled",
      "tierRequiresEnterprisePackage",
    ]) {
      if (typeof core[fn] === "function") pass(`core export:${fn}`);
      else fail(`core export:${fn}`, "missing");
    }
  }

  // 3. Load EE from workspace
  const loaderPath = path.join(root, "packages/core/dist/enterprise_loader.js");
  if (existsSync(loaderPath)) {
    const loader = await import(pathToFile(loaderPath));
    process.env.AGENT_ENTERPRISE_DIR = path.join(root, "packages/enterprise");
    const loaded = await loader.loadEnterpriseModule();
    if (loaded.ok) {
      pass("loadEnterpriseModule", loaded.source);
      if (typeof loaded.module.wireEnterpriseHarness === "function") {
        pass("wireEnterpriseHarness export");
      } else {
        fail("wireEnterpriseHarness export", "missing");
      }
    } else {
      fail("loadEnterpriseModule", loaded.reason);
    }
    delete process.env.AGENT_ENTERPRISE_DIR;
  }

  // 4. Pack + extract + load cycle
  const packScript = path.join(root, "scripts/pack-enterprise-bundle.mjs");
  if (existsSync(packScript)) {
    const pack = spawnSync(process.execPath, [packScript], { cwd: root, encoding: "utf8" });
    if (pack.status === 0 && existsSync(path.join(root, "enterprise-bundle.tar.gz"))) {
      pass("enterprise:pack");
      const tmpInstall = mkdtempSync(path.join(tmpdir(), "liminal-ee-audit-"));
      const extract = spawnSync("tar", ["-xzf", path.join(root, "enterprise-bundle.tar.gz"), "-C", tmpInstall], {
        encoding: "utf8",
      });
      if (extract.status === 0 && existsSync(path.join(tmpInstall, "dist", "index.js"))) {
        pass("enterprise:extract");
        process.env.AGENT_ENTERPRISE_DIR = tmpInstall;
        const loader = await import(pathToFile(loaderPath));
        await loader.linkEnterpriseHostDependencies(tmpInstall);
        const loaded2 = await loader.loadEnterpriseModule();
        if (loaded2.ok) pass("loadEnterpriseModule:from-tarball", loaded2.source);
        else fail("loadEnterpriseModule:from-tarball", loaded2.reason);
        delete process.env.AGENT_ENTERPRISE_DIR;
      } else {
        fail("enterprise:extract", extract.stderr?.trim() || "tar failed");
      }
      rmSync(tmpInstall, { recursive: true, force: true });
    } else {
      fail("enterprise:pack", pack.stderr?.trim() || "pack script failed");
    }
  }

  // 5. Wire harness smoke (Pro entitlements, no network)
  if (existsSync(coreIndex) && existsSync(loaderPath)) {
    const core = await import(pathToFile(coreIndex));
    const loader = await import(pathToFile(loaderPath));
    process.env.AGENT_ENTERPRISE_DIR = path.join(root, "packages/enterprise");
    const loaded = await loader.loadEnterpriseModule();
    if (loaded.ok) {
      const registry = new core.ToolRegistry();
      const emitter = new core.AgentEmitter();
      const harness = {
        taskId: "audit-smoke",
        emitter,
        getContext: () => ({ refreshProtocolDynamic: () => undefined }),
      };
      const entitlements = {
        tier: "pro",
        status: "active",
        entitlements: new Set(["pro.cloud_sync", "pro.session_history", "pro.managed_inference"]),
        license: null,
        reason: "audit",
      };
      try {
        const wired = await loaded.module.wireEnterpriseHarness({
          registry,
          emitter,
          harness,
          entitlements,
          autoActivate: true,
        });
        const tools = [
          "cloud_memory_pull",
          "cloud_memory_push",
          "cloud_session_search",
        ];
        const missing = tools.filter((t) => !registry.has(t));
        if (missing.length === 0 && wired.activatedFamilies.length >= 2) {
          pass("wireEnterpriseHarness", `families=${wired.activatedFamilies.join(",")}`);
        } else {
          fail("wireEnterpriseHarness", `missing tools: ${missing.join(",")}`);
        }
      } catch (err) {
        fail("wireEnterpriseHarness", err instanceof Error ? err.message : String(err));
      }
    }
    delete process.env.AGENT_ENTERPRISE_DIR;
  }

  // 6. Enterprise registration tests
  const entTest = spawnSync("npm", ["run", "test", "-w", "packages/enterprise"], {
    cwd: root,
    shell: true,
    encoding: "utf8",
  });
  if (entTest.status === 0) pass("enterprise:unit-tests");
  else fail("enterprise:unit-tests", "see npm run test -w packages/enterprise");

  // 7. Production HTTP smoke
  if (production) {
    const endpoints = [
      { url: `${site}/api/pro/status`, expect: [200] },
      { url: `${site}/api/enterprise/bundle`, expect: [401] },
      { url: `${site}/api/pro/cloud_sync/notes`, expect: [401, 403] },
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url);
        if (ep.expect.includes(res.status)) pass(`HTTP ${res.status} ${ep.url}`);
        else fail(`HTTP ${ep.url}`, `expected ${ep.expect.join("|")}, got ${res.status}`);
      } catch (err) {
        fail(`HTTP ${ep.url}`, err instanceof Error ? err.message : String(err));
      }
    }

    // Invalid token → 403 not 503 (bundle configured)
    const bad = await fetch(`${site}/api/enterprise/bundle`, {
      headers: { Authorization: "Bearer bad.token.here" },
    });
    if (bad.status === 403) pass("HTTP bundle rejects invalid license (403)");
    else if (bad.status === 503) fail("HTTP bundle", "503 — bundle not staged on server");
    else fail("HTTP bundle invalid token", `status ${bad.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length > 0) process.exit(1);
}

function pathToFile(p) {
  return pathToFileURL(p.replace(/\\/g, "/")).href;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
