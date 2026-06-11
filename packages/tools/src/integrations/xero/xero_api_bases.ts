/** Xero API base URLs (all use the same OAuth token + xero-tenant-id). */
export const XERO_ACCOUNTING_API = "https://api.xero.com/api.xro/2.0";
export const XERO_FILES_API = "https://api.xero.com/files.xro/1.0";
export const XERO_PROJECTS_API = "https://api.xero.com/projects.xro/2.0";
export const XERO_PAYROLL_AU_API = "https://api.xero.com/payroll.xro/1.0";
export const XERO_PAYROLL_UK_NZ_API = "https://api.xero.com/payroll.xro/2.0";

export type XeroApiBase =
  | typeof XERO_ACCOUNTING_API
  | typeof XERO_FILES_API
  | typeof XERO_PROJECTS_API
  | typeof XERO_PAYROLL_AU_API
  | typeof XERO_PAYROLL_UK_NZ_API;

export const XERO_API_BASES = {
  accounting: XERO_ACCOUNTING_API,
  files: XERO_FILES_API,
  projects: XERO_PROJECTS_API,
  payroll_au: XERO_PAYROLL_AU_API,
  payroll_uk_nz: XERO_PAYROLL_UK_NZ_API,
} as const;
