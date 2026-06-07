# AgentCard (agent payments)

[AgentCard](https://agentcard.ai) gives your Liminal agent capped single-use virtual cards, an `@agentcard.email` inbox, and a Base USDC wallet for x402 payments — under spend limits you control.

**Canonical skill:** https://agentcard.ai/skill

## Harness integration

When `AGENT_AGENTCARD=1` (default), the sidecar registers the **`agentcard`** tool family (19 tools). Activate with `activate_tool_family({ family: "agentcard" })` when lazy loading is on, or mention payments/checkout in your message (intent pre-seed).

| Tool | Purpose |
| ---- | ------- |
| `agentcard_whoami` | Current login |
| `agentcard_signup` | Magic-link signup (approval) |
| `agentcard_setup` | Profile + Stripe + inbox + wallet (approval) |
| `agentcard_limit` | Show spend limit |
| `agentcard_limit_request` | Request higher limit (approval + email) |
| `agentcard_card_request` | Issue capped virtual card (approval) |
| `agentcard_card_list` / `agentcard_card_get` | List / re-fetch card details |
| `agentcard_3ds` | Checkout verification codes |
| `agentcard_mail_*` | Agent email inbox |
| `agentcard_wallet_*` | Base USDC balance, x402 fetch, send |
| `agentcard_support` | Report declines / errors |

Card issuance, wallet payments, signup, and limit changes are **approval-gated**.

## One-time setup (sidecar host)

```bash
npm install -g agentcard
agentcard signup --email you@example.com
agentcard setup
agentcard whoami
```

Install the CLI on the **same machine** that runs the Liminal sidecar. Set `AGENT_AGENTCARD_CMD` if the binary is not on PATH.

## Environment

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_AGENTCARD` | `1` | Register `agentcard_*` tools |
| `AGENT_AGENTCARD_CMD` | `agentcard` | CLI executable |
| `AGENT_AGENTCARD_TIMEOUT_MS` | `120000` | Per-call timeout (except signup) |
| `AGENT_AGENTCARD_SIGNUP_TIMEOUT_MS` | `330000` | Signup magic-link poll timeout |

Disable with `AGENT_AGENTCARD=0`.

## Agent workflow

1. `agentcard_limit` — check budget  
2. Choose path: card checkout → `agentcard_card_request`; x402 API → `agentcard_wallet_fetch`; USDC → `agentcard_wallet_send`  
3. At checkout: use card fields at merchant; if 3DS → `agentcard_3ds`  
4. On failure → `agentcard_support`

Do **not** use `run_shell agentcard …` — use the dedicated tools (rule **R-AGENTCARD**).
