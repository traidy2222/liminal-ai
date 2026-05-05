# UI Streaming and Rendering

This document describes how streaming text is rendered and protected against artifacts.

## Stream Normalization

Core streaming sanitization removes common malformed glyph patterns and invalid fragments from token deltas before UI rendering.

Goal: prevent broken fragments like mixed-symbol splits appearing in final transcript text.

## TUI Rendering Model

TUI uses a reducer-driven message list with:
- reserved rows for scroll indicators/error banner
- bounded message window
- scroll offset controls
- modal/input zones with stable heights

This reduces terminal jitter from dynamic layout shifts.

## Event Ordering Hardening

High-throughput streams can interleave text and structural events (tool cards, traces, retries).

Mitigation:
- queue text/trace deltas briefly
- flush buffered deltas before structural events (`tool_start`, `tool_result`, etc.)
- maintain channel separation to avoid cross-line bleed

This addresses artifacts where text appears merged into tool cards.

## Web Streaming Model

Web client consumes SSE events and applies reducer updates similarly to TUI:
- channel-aware delta handling
- batched flush behavior
- structural event ordering

Consistency between TUI and web is a quality goal.

## Common Artifact Patterns

1. **Channel bleed**: trace/user text appears inside tool lines
2. **Fragment splits**: malformed glyph separators
3. **Repaint flicker**: frequent tiny updates causing visual churn
4. **Stale remnants**: old rows left due to dynamic-height layout jumps

## Practical Debug Flow

1. confirm artifact origin (model text vs UI composition)
2. inspect event sequence around corruption
3. verify channel separation
4. verify flush-before-structure behavior
5. test long-run scenarios with heavy tool throughput

