# Evaluation

`packages/eval` runs scenario-based assertions against real harness behavior.

## What Eval Covers

Major scenario families include:
- reliability and consistency
- long-horizon behavior
- memory retrieval quality
- approval correctness
- research-quality and streaming cleanliness checks

## Guarantees and Scenario Mapping

Examples:
- query diversity: first-pass searches are not near-duplicates
- anti-looping: repeated failing intents are throttled/replanned
- synthesis quality: timeline + uncertainty + unresolved items are present
- stream cleanliness: malformed token artifacts are absent from collected text
- runtime coherence: heartbeat/execution-state events emitted

## Running Eval

```bash
npm run eval -w packages/eval
```

Supplement with targeted workspace typechecks/builds before eval when changing core/tool behavior.

## Interpreting Failures

When a scenario fails:
1. inspect trace events and tool args for drift loops
2. verify policy gates and event emissions
3. isolate whether failure is prompt-level, runtime-level, or source-quality level
4. add regression assertions before shipping fixes

## Extending Eval

When adding runtime features:
- add at least one scenario assertion for the new guarantee
- include both happy-path and stress-path coverage where practical
- capture telemetry fields needed for diagnosis

