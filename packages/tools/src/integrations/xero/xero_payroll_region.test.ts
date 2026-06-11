import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countryToPayrollRegion,
  payrollApiBase,
  payslipPath,
} from "./xero_payroll_region.js";
import { XERO_PAYROLL_AU_API, XERO_PAYROLL_UK_NZ_API } from "./xero_api_bases.js";

describe("xero_payroll_region", () => {
  it("maps country codes to payroll regions", () => {
    assert.equal(countryToPayrollRegion("AU"), "AU");
    assert.equal(countryToPayrollRegion("gb"), "UK");
    assert.equal(countryToPayrollRegion("NZ"), "NZ");
    assert.equal(countryToPayrollRegion("US"), null);
  });

  it("selects AU vs UK/NZ API bases", () => {
    assert.equal(payrollApiBase("AU"), XERO_PAYROLL_AU_API);
    assert.equal(payrollApiBase("UK"), XERO_PAYROLL_UK_NZ_API);
    assert.equal(payrollApiBase("NZ"), XERO_PAYROLL_UK_NZ_API);
  });

  it("uses Payslip vs Payslips path by region", () => {
    assert.equal(payslipPath("AU", "abc"), "/Payslip/abc");
    assert.equal(payslipPath("UK", "abc"), "/Payslips/abc");
  });
});
