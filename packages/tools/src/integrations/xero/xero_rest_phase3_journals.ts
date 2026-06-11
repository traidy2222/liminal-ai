/**
 * Xero Phase 3 — General Ledger journals (accounting.journals.read).
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroTenant,
} from "./xero_api.js";

const COMMON = xeroCommonProps();

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

export function registerXeroJournalsTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_list_journals",
      description:
        "WHAT: List general ledger journal entries (posted transactions).\n" +
        "WHEN: Audit trail, GL detail beyond manual journals — requires accounting.journals.read scope.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          offset: { type: "number", description: "Optional journal offset for pagination." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        if (typeof args["offset"] === "number" && args["offset"] >= 0) {
          params.set("offset", String(Math.floor(args["offset"])));
        }
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Journals", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_journal",
      description: "WHAT: Fetch one GL journal by JournalID GUID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("journal_id", "JournalID GUID.") },
        required: ["journal_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["journal_id"] ?? "").trim();
        if (!id) return { ok: false, error: "journal_id required" };
        return asToolResult(
          await xeroFetch(`/Journals/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_journal_by_number",
      description: "WHAT: Fetch GL journal by journal number (integer).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          journal_number: { type: "number", description: "Xero journal number." },
        },
        required: ["journal_number"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const num = Number(args["journal_number"]);
        if (!Number.isFinite(num)) return { ok: false, error: "journal_number must be numeric" };
        return asToolResult(
          await xeroFetch(`/Journals/${encodeURIComponent(String(Math.floor(num)))}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );
}
