/** Evaluation-only policy: held-out observations are not promoted into skills. */
import type { ToolRegistry } from "@liminal/core";
export function freezeHeldOutLearning(registry: ToolRegistry) {
  const tool = registry.get("procedure_memory");
  if (!tool) return;
  const readActions = ["list", "inspect", "audit", "evidence"];
  registry.replace({
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        action: {
          ...tool.parameters.properties.action,
          type: "string",
          enum: readActions,
        },
      },
    },
    description:
      tool.description +
      " Held-out evaluation: only list, inspect, audit and evidence are permitted; learning/promotion is frozen.",
    handler: async (args, context) => {
      if (!readActions.includes(String(args.action)))
        return {
          ok: false,
          error:
            "Held-out learning is frozen until the external evaluator records the outcome",
        };
      return tool.handler(args, context);
    },
  });
}
