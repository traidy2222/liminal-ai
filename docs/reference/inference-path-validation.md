# Inference Path End-to-End Validation

This document describes the inference path architecture and validation approach for Liminal.

## Architecture Overview

The inference path connects the desktop application to the Vireon managed inference proxy:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐
│   Desktop App   │ ──▶ │    Sidecar      │ ──▶ │    Harness      │ ──▶ │ api.vireondynamics.com  │
│    (Flutter)    │     │   (liminald)    │     │  (AgentHarness) │     │   (Managed Inference)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────────────┘
        │                       │                       │                         │
        │   WebSocket           │   HTTP/REST          │   OpenAI SDK           │
        │   (127.0.0.1)         │   (in-process)       │   (Bearer JWT)         │
        │                       │                       │                         │
        └───────────────────────┴───────────────────────┴─────────────────────────┘
```

## Key Components

### 1. Desktop App (`apps/liminal_desktop`)
- Native Flutter UI
- Spawns `liminald` sidecar via `packages/sidecar/src/index.ts`
- Communicates over WebSocket using `@liminal/protocol`
- Reads handshake from `~/.liminal/sidecar.json`

### 2. Sidecar (`packages/sidecar`)
- `liminald` - Node.js sidecar process
- `WsServer` - Token-gated WebSocket server on ephemeral port
- `ChatRegistry` - Manages chat sessions and harness instances
- `ChatOrchestrator` - Delegates to parallel workers

### 3. Harness (`packages/core`)
- `AgentHarness` - ReAct loop engine
- `resolveProviderConfigWithInference()` - Routes to managed or BYOK
- `inference_provider.ts` - Managed inference credential resolution
- `inference_session.ts` - Session JWT caching (15min TTL)

### 4. Managed Inference Proxy (`api.vireondynamics.com`)
- OpenAI-compatible API at `/v1/inference`
- Session management at `/api/inference/session`
- Model catalog at `/api/inference/models`
- Usage status at `/api/inference/status`

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_INFERENCE_MODE` | `auto` | `byok` \| `managed` \| `auto` |
| `AGENT_INFERENCE_BASE_URL` | `https://api.vireondynamics.com/v1/inference` | Managed proxy root |
| `AGENT_INFERENCE_SESSION_URL` | `https://www.vireondynamics.com/api/inference/session` | Session JWT endpoint |
| `AGENT_INFERENCE_SESSION_TOKEN` | — | Pinned session JWT for CI |
| `AGENT_INFERENCE_PREFER_MANAGED` | `1` | In auto mode, prefer managed |
| `AGENT_MANAGED_PROVIDER` | `auto` | `auto` \| `bedrock` \| `openrouter` \| `kimchi` |

## Validation Script

Run the end-to-end validation:

```bash
npx tsx scripts/validate-inference-path.ts
```

### Validation Steps

1. **Core Configuration**
   - Managed inference base URL verification
   - Inference mode resolution
   - Managed provider preference

2. **Provider Resolution**
   - BYOK provider sync resolution
   - Provider resolution with inference
   - Managed OpenRouter credentials

3. **Managed Inference Status**
   - Inference usage status (credits/entitlement)
   - Managed inference model catalog

4. **Live API Call**
   - Chat completion through managed inference proxy

### Example Output

```
Liminal Inference Path Validation

This script validates the end-to-end inference path:
  desktop -> sidecar -> harness -> api.vireondynamics.com

=== Core Configuration ===
✓ Base URL matches: https://api.vireondynamics.com/v1/inference
✓ Mode: auto
✓ Provider preference: auto

=== Provider Resolution ===
✓ BYOK provider: AGENT_API_KEY @ https://openrouter.ai/api/v1
✓ Provider: VIREON_MANAGED @ https://api.vireondynamics.com/v1/inference
✓ Credentials resolved: route=managed, base=/v1/inference

=== Managed Inference Status ===
✓ Credits: $15.00 remaining
✓ Catalog: 42 models from bedrock (us-east-1)

=== Live API Call ===
✓ Completion OK (847ms): "pong"

Summary: 9/9 passed
```

## Gap Detection

The validation script identifies common gaps:

- **No BYOK fallback**: Set `AGENT_API_KEY` in `.env`
- **No Pro license**: Run `liminal login` for managed inference
- **Credits exhausted**: Top up at Account → Managed inference
- **Auth errors**: Check license/session token validity

## Unit Tests

Run the unit tests:

```bash
npx tsx --test scripts/validate-inference-path.test.ts
```

Tests cover:
- `managedInferenceBaseUrl()` returns correct URL
- `resolveInferenceMode()` respects env overrides
- `resolveProviderConfig()` throws without API key
- `isInferenceBudgetExceededError()` classifies 402 errors
- `isManagedInferenceAuthError()` classifies 401 auth errors

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Sign in to Vireon first" | No license resolved | Run `liminal login` |
| `AGENT_INFERENCE_MODE=managed requires pro.managed_inference` | Not Pro+ | Use `byok` mode |
| HTTP 402 / "credit limit reached" | Credits exhausted | Top up at Account page |
| "Managed providers temporarily busy" | Upstream rate limit | Retry shortly |
| Empty catalog | No license or network error | Check login and connectivity |

## Related Files

- `packages/core/src/inference_provider.ts` - Managed inference client
- `packages/core/src/inference_session.ts` - Session JWT cache
- `packages/core/src/provider_config.ts` - Provider routing
- `packages/sidecar/src/index.ts` - Sidecar entry point
- `docs/guides/managed-inference.md` - User-facing docs
