/**
 * Microsoft Planner task REST helpers.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function plannerRestEnabled(): boolean {
  return microsoftRestEnabled();
}

export function createPlannerRestTools(): ToolDefinition[] {
  const createTask = defineTool({
    name: "planner_rest_create_task",
    description: "Create a Planner task in a plan.",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        title: { type: "string" },
        bucket_id: { type: "string" },
        due_datetime: { type: "string", description: "ISO 8601 due date." },
        assignments: {
          type: "array",
          items: { type: "string" },
          description: "User ids to assign.",
        },
      },
      required: ["plan_id", "title"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!plannerRestEnabled()) return graphErrorResult("Planner REST is off.");
      const body: Record<string, unknown> = {
        planId: String(args["plan_id"] ?? ""),
        title: String(args["title"] ?? ""),
      };
      const bucketId = String(args["bucket_id"] ?? "").trim();
      if (bucketId) body.bucketId = bucketId;
      const due = String(args["due_datetime"] ?? "").trim();
      if (due) body.dueDateTime = due;
      const assignees = Array.isArray(args["assignments"])
        ? (args["assignments"] as unknown[]).map(String).filter(Boolean)
        : [];
      if (assignees.length) {
        const assignments: Record<string, unknown> = {};
        for (const uid of assignees) {
          assignments[uid] = {
            "@odata.type": "#microsoft.graph.plannerAssignment",
            orderHint: " !",
          };
        }
        body.assignments = assignments;
      }
      const result = await graphApiJson("/planner/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const listPlans = defineTool({
    name: "planner_rest_list_my_plans",
    description: "List Planner plans for the signed-in user.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!plannerRestEnabled()) return graphErrorResult("Planner REST is off.");
      const result = await graphApiJson("/me/planner/plans");
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const listTodoLists = defineTool({
    name: "todo_rest_list_lists",
    description: "List Microsoft To Do task lists.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!plannerRestEnabled()) return graphErrorResult("To Do REST is off.");
      const result = await graphApiJson("/me/todo/lists");
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const createTodoTask = defineTool({
    name: "todo_rest_create_task",
    description: "Create a task in a Microsoft To Do list.",
    parameters: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        title: { type: "string" },
        body_text: { type: "string" },
        due_datetime: { type: "string" },
      },
      required: ["list_id", "title"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!plannerRestEnabled()) return graphErrorResult("To Do REST is off.");
      const listId = String(args["list_id"] ?? "").trim();
      const body: Record<string, unknown> = { title: String(args["title"] ?? "") };
      const note = String(args["body_text"] ?? "").trim();
      if (note) body.body = { content: note, contentType: "text" };
      const due = String(args["due_datetime"] ?? "").trim();
      if (due) body.dueDateTime = { dateTime: due, timeZone: "UTC" };
      const result = await graphApiJson(
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [createTask, listPlans, listTodoLists, createTodoTask];
}
