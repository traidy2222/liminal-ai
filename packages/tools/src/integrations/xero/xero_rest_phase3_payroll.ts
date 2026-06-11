/**
 * Xero Phase 3 — Payroll API (AU v1.0 / UK+NZ v2.0).
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  jsonOutput,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroTenant,
} from "./xero_api.js";
import {
  payrollApiBase,
  payslipPath,
  resolvePayrollRegion,
  type PayrollRegion,
} from "./xero_payroll_region.js";

const COMMON = {
  ...xeroCommonProps(),
  payroll_region: {
    type: "string",
    enum: ["AU", "UK", "NZ"],
    description: "Override payroll API region (default: infer from org CountryCode).",
  },
} satisfies Record<string, PropertySchema>;

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

async function payrollFetch(
  args: Record<string, unknown>,
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  const regionR = await resolvePayrollRegion(args);
  if (!regionR.ok) return regionR;
  return xeroFetch(path, {
    method: init.method,
    body: init.body,
    apiBase: payrollApiBase(regionR.region),
    accountHint: xeroHint(args),
    tenantId: xeroTenant(args),
  });
}

export function registerXeroPayrollTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_payroll_region",
      description:
        "WHAT: Detect payroll API region (AU, UK, NZ) from organisation country.\n" +
        "WHEN: Before other payroll_* calls — AU uses API v1.0, UK/NZ use v2.0.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> => {
        const r = await resolvePayrollRegion(args);
        if (!r.ok) return r;
        return {
          ok: true,
          output: jsonOutput({
            payroll_region: r.region,
            api_base: payrollApiBase(r.region),
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_payroll_employees",
      description: "WHAT: List payroll employees.\nWHEN: HR/payroll queries — requires payroll.employees scope.",
      parameters: {
        type: "object",
        properties: { ...COMMON, page: { type: "number" }, where: { type: "string" } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const params = xeroPageParams(args);
        const path =
          regionR.region === "AU"
            ? xeroPathWithQuery("/Employees", params)
            : xeroPathWithQuery("/Employees", params);
        return asToolResult(await payrollFetch(args, path));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_payroll_employee",
      description: "WHAT: Fetch one payroll employee by ID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("employee_id", "Employee ID GUID.") },
        required: ["employee_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["employee_id"] ?? "").trim();
        if (!id) return { ok: false, error: "employee_id required" };
        return asToolResult(await payrollFetch(args, `/Employees/${encodeURIComponent(id)}`));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_payroll_payruns",
      description: "WHAT: List pay runs.\nWHEN: Payroll processing status.",
      parameters: {
        type: "object",
        properties: { ...COMMON, page: { type: "number" } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const params = xeroPageParams(args);
        return asToolResult(await payrollFetch(args, xeroPathWithQuery("/PayRuns", params)));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_payroll_payrun",
      description: "WHAT: Fetch one pay run by PayRunID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("payrun_id", "PayRunID GUID.") },
        required: ["payrun_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["payrun_id"] ?? "").trim();
        if (!id) return { ok: false, error: "payrun_id required" };
        return asToolResult(await payrollFetch(args, `/PayRuns/${encodeURIComponent(id)}`));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_payroll_timesheets",
      description: "WHAT: List payroll timesheets.",
      parameters: {
        type: "object",
        properties: { ...COMMON, page: { type: "number" }, where: { type: "string" } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(await payrollFetch(args, xeroPathWithQuery("/Timesheets", params)));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_payroll_timesheet",
      description: "WHAT: Fetch one timesheet by TimesheetID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("timesheet_id", "TimesheetID GUID.") },
        required: ["timesheet_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["timesheet_id"] ?? "").trim();
        if (!id) return { ok: false, error: "timesheet_id required" };
        return asToolResult(await payrollFetch(args, `/Timesheets/${encodeURIComponent(id)}`));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_payroll_settings",
      description: "WHAT: Fetch payroll organisation settings (calendars, accounts, etc.).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> => asToolResult(await payrollFetch(args, "/Settings")),
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_payroll_payslip",
      description: "WHAT: Fetch payslip detail by PayslipID.\nWHEN: Employee pay breakdown — payroll.payslip.read scope.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("payslip_id", "PayslipID GUID.") },
        required: ["payslip_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["payslip_id"] ?? "").trim();
        if (!id) return { ok: false, error: "payslip_id required" };
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        return asToolResult(
          await xeroFetch(payslipPath(regionR.region, id), {
            apiBase: payrollApiBase(regionR.region),
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_payroll_timesheet",
      description:
        "WHAT: Create a draft payroll timesheet.\n" +
        "WHEN: Log employee hours for payroll — shape varies by region; prefer xero_get_payroll_settings first.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          employee_id: { type: "string" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
          timesheet_lines: {
            type: "array",
            description: "Region-specific line objects (earnings rate, units, etc.).",
            items: { type: "object" },
          },
        },
        required: ["employee_id", "start_date", "end_date"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const employeeId = String(args["employee_id"] ?? "").trim();
        const start = String(args["start_date"] ?? "").trim();
        const end = String(args["end_date"] ?? "").trim();
        if (!employeeId || !start || !end) {
          return { ok: false, error: "employee_id, start_date, end_date required" };
        }
        const body = buildTimesheetBody(regionR.region, employeeId, start, end, args["timesheet_lines"]);
        return asToolResult(
          await payrollFetch(args, "/Timesheets", { method: "POST", body })
        );
      },
    })
  );
}

function buildTimesheetBody(
  region: PayrollRegion,
  employeeId: string,
  startDate: string,
  endDate: string,
  lines: unknown
): unknown {
  if (region === "AU") {
    return {
      Timesheets: [
        {
          EmployeeID: employeeId,
          StartDate: startDate,
          EndDate: endDate,
          ...(Array.isArray(lines) ? { TimesheetLines: lines } : {}),
        },
      ],
    };
  }
  return {
    employeeID: employeeId,
    startDate,
    endDate,
    ...(Array.isArray(lines) ? { timesheetLines: lines } : {}),
  };
}
