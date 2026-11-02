/** Browser-safe identification of OpenRouter routers rather than concrete models. */
export function isMultiModelRouter(model: string): boolean {
  return /^openrouter\/(?:auto(?:-[^:]+)?|free|fusion|bodybuilder|pareto-[^:]+)(?::.*)?$/i.test(model.trim());
}
