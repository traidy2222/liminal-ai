/**
 * Xero Phase 3 — GL journals, Files, Projects, Payroll registration.
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { jsonOutput, xeroCommonProps } from "./xero_api.js";
import { registerXeroFilesTools } from "./xero_rest_phase3_files.js";
import { registerXeroJournalsTools } from "./xero_rest_phase3_journals.js";
import { registerXeroPayrollTools } from "./xero_rest_phase3_payroll.js";
import { registerXeroProjectsTools } from "./xero_rest_phase3_projects.js";

export function registerXeroRestPhase3Tools(registry: ToolRegistry): void {
  registerXeroJournalsTools(registry);
  registerXeroFilesTools(registry);
  registerXeroProjectsTools(registry);
  registerXeroPayrollTools(registry);

  registry.register(
    defineTool({
      name: "xero_bank_feeds_info",
      description:
        "WHAT: Explain Xero Bank Feeds API availability (partner-only).\n" +
        "WHEN: User asks about direct bank feed import — not available via standard OAuth.",
      parameters: { type: "object", properties: { ...xeroCommonProps() }, additionalProperties: false },
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        output: jsonOutput({
          available: false,
          reason:
            "Xero Bank Feeds API requires Xero partner approval and separate bankfeeds scopes — not included in Liminal hosted OAuth.",
          alternatives: [
            "Use xero_list_bank_transactions and xero_create_bank_transaction for manual/coded bank lines.",
            "Use xero_list_linked_transactions and xero_create_linked_transaction for reconciliation.",
            "Use xero_list_bank_accounts + xero_record_invoice_payment for payment recording.",
          ],
          partner_docs: "https://developer.xero.com/documentation/api/bankfeeds/overview",
        }),
      }),
    })
  );
}
