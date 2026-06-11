/**
 * Xero Phase 3.5 — Payroll writes (pay runs, employees, timesheets).
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroTenant,
} from "./xero_api.js";
import {
  payrollApiBase,
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

function buildPayRunCreateBody(
  region: PayrollRegion,
  calendarId: string,
  periodStart: string,
  periodEnd: string
): unknown {
  if (region === "AU") {
    return {
      PayRuns: [
        {
          PayrollCalendarID: calendarId,
          PayRunPeriodStartDate: periodStart,
          PayRunPeriodEndDate: periodEnd,
          PayRunStatus: "DRAFT",
        },
      ],
    };
  }
  return {
    payRunPeriodStartDate: periodStart,
    payRunPeriodEndDate: periodEnd,
    payrollCalendarID: calendarId,
  };
}

function buildPayRunUpdateBody(
  region: PayrollRegion,
  payrunId: string,
  status: string
): { path: string; body: unknown; method: string } {
  if (region === "AU") {
    return {
      path: `/PayRuns/${encodeURIComponent(payrunId)}`,
      method: "POST",
      body: {
        PayRuns: [{ PayRunID: payrunId, PayRunStatus: status }],
      },
    };
  }
  return {
    path: `/PayRuns/${encodeURIComponent(payrunId)}`,
    method: "PUT",
    body: { payRunID: payrunId, payRunStatus: status },
  };
}

export function registerXeroPhase35PayrollTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_create_payroll_payrun",
      description:
        "WHAT: Create a draft pay run for a payroll calendar period.\n" +
        "WHEN: Start payroll — get calendar IDs from xero_get_payroll_settings.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          payroll_calendar_id: { type: "string", description: "PayrollCalendarID from settings." },
          period_start: { type: "string", description: "YYYY-MM-DD" },
          period_end: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["payroll_calendar_id", "period_start", "period_end"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const calendarId = String(args["payroll_calendar_id"] ?? "").trim();
        const start = String(args["period_start"] ?? "").trim();
        const end = String(args["period_end"] ?? "").trim();
        if (!calendarId || !start || !end) {
          return { ok: false, error: "payroll_calendar_id, period_start, period_end required" };
        }
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const body = buildPayRunCreateBody(regionR.region, calendarId, start, end);
        const path = regionR.region === "AU" ? "/PayRuns" : "/PayRuns";
        const method = regionR.region === "AU" ? "POST" : "POST";
        return asToolResult(await payrollFetch(args, path, { method, body }));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_payroll_payrun",
      description:
        "WHAT: Update pay run status (e.g. POSTED to finalise).\n" +
        "WHEN: Approve/post pay run after review — status values vary by region.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("payrun_id", "PayRunID GUID."),
          status: {
            type: "string",
            description: "AU: DRAFT|POSTED. UK/NZ: Draft|Posted (case per API).",
          },
        },
        required: ["payrun_id", "status"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["payrun_id"] ?? "").trim();
        const status = String(args["status"] ?? "").trim();
        if (!id || !status) return { ok: false, error: "payrun_id and status required" };
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const { path, body, method } = buildPayRunUpdateBody(regionR.region, id, status);
        return asToolResult(await payrollFetch(args, path, { method, body }));
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_payroll_employee",
      description:
        "WHAT: Update a payroll employee record.\n" +
        "WHEN: HR changes — pass employee object fields per region API docs.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("employee_id", "EmployeeID GUID."),
          employee: {
            type: "object",
            description: "Partial employee payload (merged with employee_id).",
          },
        },
        required: ["employee_id", "employee"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["employee_id"] ?? "").trim();
        const payload = args["employee"];
        if (!id || !payload || typeof payload !== "object") {
          return { ok: false, error: "employee_id and employee object required" };
        }
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const merged = { ...(payload as Record<string, unknown>) };
        if (regionR.region === "AU") {
          merged["EmployeeID"] = id;
          return asToolResult(
            await payrollFetch(args, `/Employees/${encodeURIComponent(id)}`, {
              method: "POST",
              body: { Employees: [merged] },
            })
          );
        }
        merged["employeeID"] = id;
        return asToolResult(
          await payrollFetch(args, `/Employees/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: merged,
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_payroll_timesheet",
      description:
        "WHAT: Update an existing payroll timesheet (lines, status).\n" +
        "WHEN: Correct hours before pay run — prefer xero_get_payroll_timesheet first.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("timesheet_id", "TimesheetID GUID."),
          timesheet: {
            type: "object",
            description: "Partial timesheet payload merged with TimesheetID.",
          },
        },
        required: ["timesheet_id", "timesheet"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["timesheet_id"] ?? "").trim();
        const payload = args["timesheet"];
        if (!id || !payload || typeof payload !== "object") {
          return { ok: false, error: "timesheet_id and timesheet object required" };
        }
        const regionR = await resolvePayrollRegion(args);
        if (!regionR.ok) return regionR;
        const merged = { ...(payload as Record<string, unknown>) };
        if (regionR.region === "AU") {
          merged["TimesheetID"] = id;
          return asToolResult(
            await payrollFetch(args, `/Timesheets/${encodeURIComponent(id)}`, {
              method: "POST",
              body: { Timesheets: [merged] },
            })
          );
        }
        merged["timesheetID"] = id;
        return asToolResult(
          await payrollFetch(args, `/Timesheets/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: merged,
          })
        );
      },
    })
  );
}
