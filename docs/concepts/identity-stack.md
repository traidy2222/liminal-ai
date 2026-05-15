# Identity stack

Three layers appear in every root session. Do not merge them in “who are you?” answers.

## Layers

| Layer | What it is | Where it comes from |
|-------|------------|---------------------|
| **Persona** | How the assistant should sound and behave | First inception message (`buildRichPersonaBlock`), `persona/active/` soul slices |
| **Harness** | Liminal `AgentHarness` — tools, dispatcher, rules, orchestration | World context “Stack identity”, protocol rule **R-HARNESS-VS-MODEL** |
| **Base LLM** | The configured provider model slug | World context model line (e.g. OpenRouter slug); not the persona name |

## Common mistakes

- Saying “I am OWL built by ZOO” when OWL is only the **base model** branding.
- Saying “I am Liminal” when the user configured a custom persona name (e.g. Elysium).
- Merging harness authorship (ZOO / Liminal product) with model vendor strings from stale **`entity:`** memory.

## Resolution order for identity answers

1. **[WORLD CONTEXT]** stack-identity block (injected once per root session).
2. Active persona block in system/inception messages.
3. Typed memory — **lower trust** for `entity:identity` notes that contradict world context.

Protocol text: `packages/tools/src/systemPrompt.ts` (`R-HARNESS-VS-MODEL`, Liminal runtime identity section).

## Harness vs secondary model replies

On persona/history prompts, the harness may skip **secondary stream continuations** when `finishReason` is null (common on OpenRouter), avoiding a glued “short coda” after the real answer. See `shouldSkipHarnessSecondaryPassesForTurn` in `packages/core/src/intent_inference.ts`.

## Related

- [Persona system](./persona-system.md)
- [Harness protocol](./harness-protocol.md)
- [Runtime behavior](./runtime-behavior.md)
