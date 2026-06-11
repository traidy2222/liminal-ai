/**
 * Xero Phase 3 — Projects API (time, tasks, job costing).
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
import { XERO_PROJECTS_API } from "./xero_api_bases.js";

const COMMON = xeroCommonProps();
const PROJECTS_OPTS = { apiBase: XERO_PROJECTS_API as typeof XERO_PROJECTS_API };

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

export function registerXeroProjectsTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_list_projects",
      description:
        "WHAT: List projects (jobs) with time/cost totals.\n" +
        "WHEN: Job profitability, WIP — requires projects.read scope.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string", description: "Filter by customer ContactID." },
          state: { type: "string", enum: ["INPROGRESS", "CLOSED"], description: "Project state filter." },
          page: { type: "number" },
          page_size: { type: "number", description: "1–500, default 50." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        if (typeof args["contact_id"] === "string" && args["contact_id"].trim()) {
          params.set("contactID", args["contact_id"].trim());
        }
        if (typeof args["state"] === "string") params.set("states", args["state"]);
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        if (typeof args["page_size"] === "number" && args["page_size"] > 0) {
          params.set("pageSize", String(Math.min(500, Math.floor(args["page_size"]))));
        }
        const q = params.toString();
        return asToolResult(
          await xeroFetch(q ? `/Projects?${q}` : "/Projects", {
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_project",
      description: "WHAT: Fetch one project by projectId.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("project_id", "ProjectId GUID.") },
        required: ["project_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["project_id"] ?? "").trim();
        if (!id) return { ok: false, error: "project_id required" };
        return asToolResult(
          await xeroFetch(`/Projects/${encodeURIComponent(id)}`, {
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_project",
      description: "WHAT: Create a project linked to a customer contact.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string" },
          name: { type: "string" },
          estimate_amount: { type: "number" },
          deadline: { type: "string", description: "ISO-8601 UTC deadline." },
        },
        required: ["contact_id", "name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const contactId = String(args["contact_id"] ?? "").trim();
        const name = String(args["name"] ?? "").trim();
        if (!contactId || !name) return { ok: false, error: "contact_id and name required" };
        const body: Record<string, unknown> = { contactId, name };
        const est = Number(args["estimate_amount"]);
        if (Number.isFinite(est)) body["estimateAmount"] = est;
        if (typeof args["deadline"] === "string" && args["deadline"].trim()) {
          body["deadlineUtc"] = args["deadline"].trim();
        }
        return asToolResult(
          await xeroFetch("/Projects", {
            method: "POST",
            body,
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_project",
      description: "WHAT: Update project name, estimate, deadline, or status.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          name: { type: "string" },
          estimate_amount: { type: "number" },
          deadline: { type: "string" },
          status: { type: "string", enum: ["INPROGRESS", "CLOSED"] },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["project_id"] ?? "").trim();
        if (!id) return { ok: false, error: "project_id required" };
        const body: Record<string, unknown> = {};
        if (typeof args["name"] === "string" && args["name"].trim()) body["name"] = args["name"].trim();
        const est = Number(args["estimate_amount"]);
        if (Number.isFinite(est)) body["estimateAmount"] = est;
        if (typeof args["deadline"] === "string" && args["deadline"].trim()) {
          body["deadlineUtc"] = args["deadline"].trim();
        }
        if (typeof args["status"] === "string") body["status"] = args["status"];
        if (Object.keys(body).length === 0) {
          return { ok: false, error: "provide name, estimate_amount, deadline, or status" };
        }
        return asToolResult(
          await xeroFetch(`/Projects/${encodeURIComponent(id)}`, {
            method: "PUT",
            body,
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_project_tasks",
      description: "WHAT: List tasks on a project.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          page: { type: "number" },
          page_size: { type: "number" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["project_id"] ?? "").trim();
        if (!id) return { ok: false, error: "project_id required" };
        const params = new URLSearchParams();
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        if (typeof args["page_size"] === "number" && args["page_size"] > 0) {
          params.set("pageSize", String(Math.floor(args["page_size"])));
        }
        const q = params.toString();
        const path = `/Projects/${encodeURIComponent(id)}/Tasks${q ? `?${q}` : ""}`;
        return asToolResult(
          await xeroFetch(path, {
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_project_task",
      description: "WHAT: Add a billable task to a project.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          name: { type: "string" },
          rate: { type: "object", description: "{ currency, value } hourly rate." },
          charge_type: { type: "string", enum: ["TIME", "FIXED"] },
        },
        required: ["project_id", "name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const projectId = String(args["project_id"] ?? "").trim();
        const name = String(args["name"] ?? "").trim();
        if (!projectId || !name) return { ok: false, error: "project_id and name required" };
        const body: Record<string, unknown> = { name };
        if (args["rate"] && typeof args["rate"] === "object") body["rate"] = args["rate"];
        if (typeof args["charge_type"] === "string") body["chargeType"] = args["charge_type"];
        return asToolResult(
          await xeroFetch(`/Projects/${encodeURIComponent(projectId)}/Tasks`, {
            method: "POST",
            body,
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_project_time_entries",
      description: "WHAT: List time entries logged on a project.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          page: { type: "number" },
          page_size: { type: "number" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["project_id"] ?? "").trim();
        if (!id) return { ok: false, error: "project_id required" };
        const params = new URLSearchParams();
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        if (typeof args["page_size"] === "number" && args["page_size"] > 0) {
          params.set("pageSize", String(Math.floor(args["page_size"])));
        }
        const q = params.toString();
        const path = `/Projects/${encodeURIComponent(id)}/Time${q ? `?${q}` : ""}`;
        return asToolResult(
          await xeroFetch(path, {
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_project_time_entry",
      description: "WHAT: Log time against a project task.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          task_id: { type: "string", description: "TaskId within the project." },
          user_id: { type: "string", description: "Xero user UUID who performed the work." },
          date_utc: { type: "string", description: "ISO-8601 UTC date-time." },
          duration_minutes: { type: "number" },
          description: { type: "string" },
        },
        required: ["project_id", "task_id", "user_id", "date_utc", "duration_minutes"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const projectId = String(args["project_id"] ?? "").trim();
        const taskId = String(args["task_id"] ?? "").trim();
        const userId = String(args["user_id"] ?? "").trim();
        const dateUtc = String(args["date_utc"] ?? "").trim();
        const mins = Number(args["duration_minutes"]);
        if (!projectId || !taskId || !userId || !dateUtc || !Number.isFinite(mins)) {
          return {
            ok: false,
            error: "project_id, task_id, user_id, date_utc, and duration_minutes required",
          };
        }
        const body: Record<string, unknown> = {
          userId,
          dateUtc,
          duration: mins,
          taskId,
        };
        if (typeof args["description"] === "string" && args["description"].trim()) {
          body["description"] = args["description"].trim();
        }
        return asToolResult(
          await xeroFetch(`/Projects/${encodeURIComponent(projectId)}/Time`, {
            method: "POST",
            body,
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_project_users",
      description: "WHAT: List users who can be assigned to project time entries.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(
          await xeroFetch("/ProjectsUsers", {
            ...PROJECTS_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        ),
    })
  );
}
