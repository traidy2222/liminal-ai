#!/usr/bin/env node
/**
 * liminal login — browser sign-in; stores license in ~/.liminal/
 */
async function main() {
  const coreUrl = new URL("../../packages/core/dist/vireon_connect.js", import.meta.url).href;
  let mod;
  try {
    mod = await import(coreUrl);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error("Build core first: npm run build -w packages/core");
      process.exit(1);
    }
    throw err;
  }
  const { runVireonConnectFlow } = mod;
  const result = await runVireonConnectFlow({
    onStatus: (m) => console.log(m),
  });
  console.log(`\nSigned in as ${result.email} (${result.tier})`);
  console.log("License saved to ~/.liminal/license.json");

  const installUrl = new URL("../../packages/core/dist/enterprise_install.js", import.meta.url).href;
  try {
    const { tierRequiresEnterprisePackage, ensureEnterpriseEditionInstalled } = await import(installUrl);
    if (tierRequiresEnterprisePackage(result.tier)) {
      console.log("Installing Enterprise Edition features…");
      const install = await ensureEnterpriseEditionInstalled();
      if (install.installed) {
        console.log(
          install.skipped
            ? `Enterprise Edition already present${install.version ? ` (v${install.version})` : ""}.`
            : `Enterprise Edition installed${install.version ? ` (v${install.version})` : ""} to ~/.liminal/enterprise/`
        );
      } else if (install.reason) {
        console.warn(`Enterprise Edition install skipped: ${install.reason}`);
      }
    }
  } catch {
    /* older core build without enterprise_install */
  }

  if (result.entitlements.includes("pro.managed_inference")) {
    console.log("Managed inference is available — set AGENT_INFERENCE_MODE=auto in Settings (default).");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
