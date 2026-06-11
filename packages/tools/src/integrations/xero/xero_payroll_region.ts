/**
 * Payroll API region routing — AU uses v1.0 base; UK/NZ use v2.0.
 */
import { xeroFetch, xeroHint, xeroTenant } from "./xero_api.js";
import { XERO_PAYROLL_AU_API, XERO_PAYROLL_UK_NZ_API, type XeroApiBase } from "./xero_api_bases.js";
import { xeroEntityArray } from "./xero_helpers.js";

export type PayrollRegion = "AU" | "UK" | "NZ";

export function payrollApiBase(region: PayrollRegion): XeroApiBase {
  return region === "AU" ? XERO_PAYROLL_AU_API : XERO_PAYROLL_UK_NZ_API;
}

export function countryToPayrollRegion(countryCode: string | undefined): PayrollRegion | null {
  const c = (countryCode ?? "").trim().toUpperCase();
  if (c === "AU") return "AU";
  if (c === "GB" || c === "UK") return "UK";
  if (c === "NZ") return "NZ";
  return null;
}

export function payslipPath(region: PayrollRegion, payslipId: string): string {
  const id = encodeURIComponent(payslipId);
  return region === "AU" ? `/Payslip/${id}` : `/Payslips/${id}`;
}

export async function resolvePayrollRegion(
  args: Record<string, unknown>
): Promise<{ ok: true; region: PayrollRegion } | { ok: false; error: string }> {
  const explicit = typeof args["payroll_region"] === "string" ? args["payroll_region"].trim().toUpperCase() : "";
  if (explicit === "AU" || explicit === "UK" || explicit === "NZ") {
    return { ok: true, region: explicit as PayrollRegion };
  }
  const r = await xeroFetch("/Organisation", {
    accountHint: xeroHint(args),
    tenantId: xeroTenant(args),
  });
  if (!r.ok) return r;
  const org = xeroEntityArray(r.data, "Organisations")[0];
  const country = org?.["CountryCode"];
  const region = countryToPayrollRegion(typeof country === "string" ? country : undefined);
  if (!region) {
    return {
      ok: false,
      error:
        `organisation country "${String(country ?? "unknown")}" has no Xero Payroll API — pass payroll_region AU, UK, or NZ`,
    };
  }
  return { ok: true, region };
}
