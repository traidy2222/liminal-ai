# Managed inference

**Managed inference** lets you run Liminal with **no provider API key of your own**. On Pro
(and higher), the harness routes model calls through Vireon's metered, OpenAI-compatible
proxy instead of `AGENT_API_KEY`. Community Edition stays bring-your-own-key (BYOK) and fully
local — managed inference only *adds* a no-key path for entitled users.

This guide covers when to use each mode, how to turn managed inference on, what routes
through it, how credits work, and how to troubleshoot. For the entitlement model see
[Pro &amp; Enterprise](../reference/pro-and-enterprise.md).

## BYOK vs managed — which should I use?

| | Bring your own key (BYOK) | Managed inference |
| --- | --- | --- |
| Tier | Community+ | Pro+ |
| Provider key | Yours (`AGENT_API_KEY`) | None needed |
| Who you pay | Your provider directly (no Vireon markup) | Vireon (included credits + top-ups) |
| Model choice | Any OpenAI-compatible model you configure | Curated managed routing |
| Best for | Existing keys, specific models, fully local/air-gapped | Fastest start, no provider setup |

Both run the **identical** harness — same tools, memory, and UI. The only difference is
where the model request goes.

## Modes

Routing is controlled by **`AGENT_INFERENCE_MODE`**:

| Mode | Behavior |
| ---- | -------- |
| `auto` *(default)* | Use managed inference when you're entitled (`pro.managed_inference`); otherwise fall back to your own key |
| `managed` | Always use managed inference — errors if you aren't entitled |
| `byok` | Always use your own `AGENT_API_KEY`, even if entitled |

In `auto`, **`AGENT_INFERENCE_PREFER_MANAGED`** (default `1`) decides what happens when you
*both* are entitled *and* have a local key in `.env`: `1` prefers managed (uses your included
credits); `0` prefers your own key.

After `liminal login` on a Pro account, the harness writes managed defaults
(`AGENT_INFERENCE_MODE=managed`, `AGENT_INFERENCE_PREFER_MANAGED=1`) to your runtime prefs, so
managed inference is on without editing `.env`. Change it anytime in **Settings**.

## Enabling managed inference

1. **Subscribe to Pro** at
   [vireondynamics.com/liminal/pricing](https://www.vireondynamics.com/liminal/pricing).
2. **Sign in** so the harness has your license:

   ```bash
   liminal login
   ```

   (Or, in the web UI: **Settings → Sign in to Vireon**.) See
   [Accounts &amp; licensing](./accounts-and-licensing.md) for the full flow.
3. **That's it.** With the managed defaults applied, your next message routes through Vireon.
   You can skip the OpenRouter step in the install wizard entirely.

To confirm you're on managed routing, the web **Settings** panel shows the active route, and
provider config reports `keySource: "VIREON_MANAGED"`.

## What routes through managed inference

When managed routing is active it covers the **main chat model and the sidecars**:

- Chat completions (the ReAct loop)
- Embeddings for hybrid recall (`AGENT_EMBED_MODEL`)
- Vision (`vision_analyze`), unless you set a dedicated `AGENT_VISION_API_KEY`
- Voice sidecars (TTS / transcription) — any OpenRouter TTS/ASR slug you set in Settings
  (`AGENT_TTS_MODEL`, `AGENT_TRANSCRIBE_MODEL`); the control-plane chat model allowlist does
  not apply to `audio/speech` or `audio/transcriptions`.

Under the hood the harness exchanges your license for a short-lived session JWT at
`AGENT_INFERENCE_SESSION_URL`, then calls the OpenAI-compatible proxy at
`AGENT_INFERENCE_BASE_URL`. Sessions are refreshed automatically.

## Credits and usage

Pro includes a monthly credit allowance at pass-through rates (Vireon does not mark up the
underlying token cost), with optional top-ups.

- **Check usage:** web UI inference banner, or **Account → Managed inference** on the site
  (`GET /api/inference/status` returns remaining/cap/used and the period end).
- **Top up:** Account → Managed inference.
- **Budget reached:** the proxy returns HTTP **402**; the harness surfaces a clear top-up
  hint instead of a raw error.

## Headless / CI

Browser sign-in isn't available in CI. Two options:

```bash
# Option A — pin a license token; the harness mints sessions automatically
AGENT_LICENSE_KEY=<license-token>
AGENT_LICENSE_PREFER_ENV=1
AGENT_INFERENCE_MODE=managed

# Option B — pin a pre-minted session token directly (skips the license exchange)
AGENT_INFERENCE_SESSION_TOKEN=<session-jwt>
```

## Switching back to your own key

Set the mode to BYOK (Settings, or env) and provide a key:

```bash
AGENT_INFERENCE_MODE=byok
AGENT_API_KEY=sk-or-...
AGENT_API_BASE_URL=https://openrouter.ai/api/v1
```

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| "Sign in to Vireon first…" | No license resolved. Run `liminal login`, or set `AGENT_INFERENCE_SESSION_TOKEN` for CI. |
| `AGENT_INFERENCE_MODE=managed requires pro.managed_inference…` | Account isn't Pro+ or the license didn't verify. Check **Account**, or fall back to `byok`. |
| HTTP 402 / "credit limit reached" | Monthly credits exhausted. Top up at Account → Managed inference. |
| Still using my own key on Pro | `auto` with `AGENT_INFERENCE_PREFER_MANAGED=0`, or mode is `byok`. Set `managed` (or prefer-managed `1`). |
| Managed providers "temporarily busy" | Upstream rate limit; the proxy already retried. Retry shortly. |

## Environment reference

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_INFERENCE_MODE` | `auto` | `byok` \| `managed` \| `auto` |
| `AGENT_INFERENCE_PREFER_MANAGED` | `1` | In `auto`, prefer managed even if a local key is set |
| `AGENT_INFERENCE_BASE_URL` | `https://api.vireondynamics.com/v1/inference` | Managed proxy root |
| `AGENT_INFERENCE_SESSION_URL` | `https://www.vireondynamics.com/api/inference/session` | Mints session JWTs |
| `AGENT_INFERENCE_SESSION_TOKEN` | — | Pinned session JWT for CI/headless |
| `AGENT_API_KEY` | — | Your provider key (BYOK) |

See also: [Accounts &amp; licensing](./accounts-and-licensing.md) ·
[Pro &amp; Enterprise](../reference/pro-and-enterprise.md).
