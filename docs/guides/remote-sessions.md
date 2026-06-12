# Remote sessions (`/remote`)

Share a **live view** of the active chat with another device on your LAN, or (with Vireon Pro) from anywhere via the cloud relay.

## Quick start (desktop)

1. Open a chat in **Liminal Desktop**.
2. Type `/remote` in the composer.
3. Open the **LAN** URL on your phone or another computer on the same Wi‑Fi.
4. Watch the assistant stream in real time (view-only by default).

Revoke with `/remote off`.

## Slash commands

| Command | Effect |
|---------|--------|
| `/remote` | Enable **view-only** join link for the active chat |
| `/remote control` | Enable **control** link (send messages, approve tools) |
| `/remote cloud` | View link + register with Vireon cloud relay (Pro) |
| `/remote cloud control` | Control link + cloud relay |
| `/remote off` | Revoke all join links for this chat |
| `/remote status` | Show active codes, URLs, expiry, guest count |
| `/remote revoke CODE` | Revoke a single join code |

Works in **desktop**, **web** (`npm run web`), and is listed in **TUI** help (TUI cannot host sessions — use desktop or web).

## Roles

| Role | Can |
|------|-----|
| **view** | Replay transcript, watch live events |
| **control** | Above + `send_message`, `abort`, `resolve_approval`, `resolve_ask_user`, PTY/browser streams |
| **owner** | Full sidecar command set (desktop / web host UI) |

ACL is enforced in `@liminal/core` (`remoteCommandAllowed`) and gated in `liminald` / web `WebRemoteService`.

## Architecture

- **Host authority:** The process that owns the harness — desktop `liminald` (sidecar) or web `ChatManager` when running `npm run web`.
- **LAN transport:** Secondary HTTP listener on `LIMINAL_REMOTE_BIND_HOST` (default `0.0.0.0`) serves `/remote/join` and upgrades guests with `?join=<token>`.
- **Cloud transport (Pro):** Host registers with `POST https://www.vireondynamics.com/api/remote/sessions` (`pro.remote_sessions`). Frames are forwarded to the relay; guests open `/remote/join/<code>` and subscribe to SSE.

```text
Host UI  →  remote_enable  →  RemoteHostManager
Guest    →  /remote/join?code=…  →  WS ?join=token  →  live events
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIMINAL_REMOTE_TTL_MS` | `14400000` (4h) | Join code / token lifetime |
| `LIMINAL_REMOTE_BIND_HOST` | `0.0.0.0` | LAN bind address (`off` disables LAN listener) |
| `LIMINAL_REMOTE_CLOUD_ORIGIN` | `https://www.vireondynamics.com` | Cloud relay base URL |

## Security notes

- Join tokens are ephemeral (not persisted across sidecar restart).
- View-only is the default; use `/remote control` only when you trust the guest device.
- Guests only receive events for their bound `chatId`.
- Failed join attempts on the LAN listener should be rate-limited at the network edge in untrusted environments.

## Web-only / same-machine dev

When using `npm run web` without desktop, remote guests attach to the web server's LAN port with the same join flow (`WebRemoteService`).

## Limitations

- **TUI** does not host remote sessions.
- **Cloud relay** uses HTTP polling on Vireon (not browser SSE) and requires **Upstash Redis** (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) on the website so serverless instances share session state. Prefer **LAN** for lowest latency.
- Re-run `/remote` after sidecar restart (tokens are in-memory only).
