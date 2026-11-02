# Response latency

The default response path uses local intent routing. Set `AGENT_INTENT_INFERENCE=1`
only when the extra classifier is wanted: it makes a separate model request before
the main stream and can wait up to `AGENT_INTENT_INFERENCE_TIMEOUT_MS` (8 seconds).
Saved preferences and environment overrides still take precedence over defaults.
Greetings and straightforward file tasks retain their local routing fast paths.
Repo-map collection for the remote classifier runs only when that classifier is on.

Installed CLI versions are probed when a root harness opens, with a five-minute
in-process cache keyed by working directory and PATH. Query-dependent memory,
workspace context, approvals, and the selected model remain on their normal paths.

Latency events now distinguish `preRequestMs` (harness preparation), `ttftMs`
(first provider output, possibly reasoning/tool arguments), and
`turnToFirstTextMs` (time from entering `send` to answer text at the emitter).
The last metric excludes desktop/browser rendering and network transport to the UI.
Turn-relative fields are reported for the first model round only. These timing events are retained in session logs without requiring per-token text logging.

## Reproduce

Build core and tools first, then run:

```sh
node scripts/benchmark-response-latency.mjs
node scripts/benchmark-response-latency.mjs --idle-ms 1500
```

These are live inference requests using the configured provider and normal billing.
Results are written to `.agent_artifacts/response-latency-benchmark.json` without
credentials or response text. The benchmark uses a minimal system prompt with no
external tools; it is not a desktop UI or full coding-session benchmark.

## Observations — 2 November 2026

With `z-ai/glm-5.3-flash` on OpenRouter, a technical explanation prompt spent
4.908 seconds in the old classifier, followed by 0.687 seconds to text in a
separate minimal direct streaming request. These isolated phase measurements
exclude other harness preparation.

After disabling classification, a real cold harness test reached text in 3.583
seconds, including 1.409 seconds of preparation. After adding startup inventory
warming, a test with 1.5 seconds of app idle before Send reached text in 2.736
seconds, including 0.900 seconds of preparation. These are individual live samples,
not statistically controlled before/after results or guaranteed service levels.
Provider and reasoning latency vary; do not describe the 0.687-second direct probe
as full-app response time. A separate routing probe found latency-priority routing
slower than price routing in that sample, so routing was left unchanged.


## DeepSeek hybrid models and routing — 0.1.7

External reasoning mode now explicitly disables default native thinking on supported
DeepSeek hybrid models when using OpenRouter-compatible routing. Native reasoning
mode still sends the selected task budget. Mandatory-reasoning models and other
compatible APIs retain their previous behavior.

New default routing prioritizes latency. `AGENT_PROVIDER_SORT` is unset by default
so it does not silently override `AGENT_PROVIDER_STRATEGY`. Explicit saved or
environment settings still win, and price routing remains available. Provider
session affinity changes with the model or routing policy, so switching strategy
does not retain the previous slow endpoint. A stable policy retains stable affinity.

Using `deepseek/deepseek-v4.1-flash-1017`, full-prompt direct probes with external
reasoning disabled and a fresh latency route reached first answer text in 1.196
and 0.788 seconds. The measured prompt was approximately 14,776 tokens. These
measurements exclude harness preparation, desktop rendering and transport; they
are individual samples, not a guaranteed service level. Earlier samples with the
old request settings reproduced multi-second provider waits and hidden thinking.
