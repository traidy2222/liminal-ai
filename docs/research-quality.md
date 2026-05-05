# Research Quality Controls

This document covers safeguards that target high-quality research-style outputs.

## Query Diversity Guard

For the first search pass in research tasks, query intents should be diversified:
1. origins/background
2. latest status
3. impact/metrics

Near-duplicate lexical overlap in first-pass search queries is blocked to reduce redundant retrieval.

## Duplicate-Intent Suppression

Repeated failing intents with near-identical arguments are throttled. The runtime asks the model to replan/change approach instead of looping.

This applies to web search and general tool calls where stable args repeat failures.

## Temporal Anchoring

Time-sensitive queries are anchored to current world-context year:
- no year provided -> current year appended
- only older years provided -> normalized to current year (for latest/current intent)
- explicit historical intent remains allowed

## Anti-Drift Signals

Runtime tracks drift and repeated failures. It can emit replanning hints earlier when patterns indicate shallow retries.

## Synthesis Checklist

Research finalization quality checks target:
- timeline/sequence presence
- multi-source grounding
- uncertainty/fragility note for fast-moving topics
- unresolved/open items

Missing components trigger a pre-finalization nudge to improve answer quality.

## Critic Reinforcement

`verify_result` critic prompts include synthesis-specific expectations so missing source spread and uncertainty framing are flagged before final output.

## Known Limits

No guard can force source reliability by itself. Retrieval quality still depends on:
- query quality
- source selection strategy
- handling of rate limits/403s
- model judgment in conflicting reports

Use eval scenarios and source curation practices for stronger guarantees.

