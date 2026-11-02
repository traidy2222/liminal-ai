import { SignatureWorkflowRun, type AgentHarness } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
export function createWorkPackageTool(harness: AgentHarness) {
  return defineTool({
    name: "work_package",
    description:
      "Validate and save the deliverables of the active guided workflow. action=list lists saved runs; resume with data={run_id} restores one; cancel exits the active workflow; status reads the current run; review validates receipt arithmetic and saves a local expense review; complete creates a sourced proposal + unsent .eml, verifies a receipt draft + attachment, or saves a patch + actual test evidence. action=blocked records the precise missing prerequisite. A failed gate means the workflow is NOT complete. See the active workflow instructions for the data shape.",
    requiresApproval: false,
    dangerLevel: "safe",
    resourceLocks: () => [`workflow:${harness.taskId}`],
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "resume",
            "cancel",
            "status",
            "review",
            "complete",
            "blocked",
          ],
        },
        data: {
          type: "object",
          description:
            "Deliverable fields defined in active workflow instructions.",
          properties: {
            client: { type: "string" },
            subject: {
              type: "string",
              description:
                "Required single-line email subject for proposal completion",
            },
            proposal: {
              type: "string",
              description: "Complete proposal body in Markdown",
            },
            reply: {
              type: "string",
              description: "Unsent plain-text reply body",
            },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                },
                required: ["url", "title"],
              },
            },
            merchant: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            currency: {
              type: "string",
              description: "Three-letter uppercase ISO currency code",
            },
            total: { type: "number" },
            tax: { type: "number" },
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  quantity: { type: "number" },
                  unit_price: {
                    type: "number",
                    description: "Tax-exclusive unit price",
                  },
                  tax_amount: {
                    type: "number",
                    description: "Total tax for this line",
                  },
                  account_code: { type: "string" },
                },
                required: [
                  "description",
                  "quantity",
                  "unit_price",
                  "tax_amount",
                ],
              },
            },
            summary: { type: "string" },
            changes: { type: "array", items: { type: "string" } },
            verification: { type: "string" },
            limitations: { type: "string" },
            reason: { type: "string" },
            run_id: { type: "string" },
          },
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        if (args.action === "list")
          return {
            ok: true,
            output: JSON.stringify(
              await SignatureWorkflowRun.list(harness.workspaceRoot),
              null,
              2,
            ),
          };
        if (args.action === "resume") {
          const id = String(
            (args.data as Record<string, unknown> | undefined)?.run_id ?? "",
          );
          harness.signatureWorkflow = await SignatureWorkflowRun.resume(
            harness.workspaceRoot,
            id,
          );
          return {
            ok: true,
            output: JSON.stringify(
              {
                state: await harness.signatureWorkflow.deliver("status", {}),
                instructions: harness.signatureWorkflow.prompt(),
              },
              null,
              2,
            ),
          };
        }
        const run = harness.signatureWorkflow;
        if (!run)
          return {
            ok: false,
            error:
              "No active guided workflow. Start with /proposal, /receipt, or /fix.",
          };
        const result = await run.deliver(String(args.action), args.data ?? {});
        if (args.action === "cancel") harness.signatureWorkflow = null;
        return { ok: true, output: JSON.stringify(result, null, 2) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
