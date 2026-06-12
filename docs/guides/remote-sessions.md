# Remote sessions (`/remote`)

Mirror the **live Liminal desktop app** to another device — like RDP for the harness UI. Guests see the real window (chat, terminal, browser dock, file panel, settings) and in **control** mode can click, scroll, and type anywhere in the mirrored surface.

## Quick start (desktop)

1. Open a chat in **Liminal Desktop**.
2. Type `/remote` in the composer (or `/remote control` for full UI control).
3. Open the **LAN** URL on your phone or another computer on the same Wi‑Fi.
4. You see a **live JPEG mirror** of the app window.

Revoke with `/remote off`.

## Slash commands

| Command | Effect |
|---------|--------|
| `/remote` | Enable **view-only** app mirror link for the active chat |
| `/remote control` | Enable **control** link (pointer + keyboard in the mirrored UI) |
| `/remote cloud` | View mirror + register with Vireon cloud relay (Pro) |
| `/remote cloud control` | Control mirror + cloud relay |
| `/remote off` | Revoke all join links for this chat |
| `/remote status` | Show active codes, URLs, expiry, guest count |
| `/remote revoke CODE` | Revoke a single join code |

Works in **desktop** (host). **TUI** lists help only — use desktop to host.

## Roles

| Role | Can |
|------|-----|
| **view** | Watch the live app mirror |
| **control** | Above + send pointer/keyboard input into the mirrored window |
| **owner** | Full sidecar command set (desktop UI) |

ACL is enforced in `@liminal/core` (`remoteCommandAllowed`) and on the UI stream path (`/remote/ui/stream`).

## Architecture

- **Host:** Liminal Desktop captures its native window(s) via `liminal_remote_desktop` (Win / macOS / Linux) and publishes JPEG frames to `liminald`.
- **LAN transport:** Secondary HTTP listener serves `/remote/join`; guests open a full-screen mirror page that connects to `WS /remote/ui/stream?join=TOKEN` for binary JPEG + JSON input.
- **Cloud transport (Pro):** Host registers with Vireon; UI frames relay through `POST /api/remote/frames`; guests poll `GET /api/remote/poll` and post input to `POST /api/remote/input`.

```text
Desktop (capture)  →  remote_ui_frame  →  sidecar UI hub  →  guest mirror page
Guest input        →  WS or cloud POST  →  remote_ui_input  →  desktop inject
```

Multi-window: spawned Liminal app windows register with the capture plugin; the stream **follows the focused** Liminal-owned window.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIMINAL_REMOTE_TTL_MS` | `14400000` (4h) | Join code / token lifetime |
| `LIMINAL_REMOTE_BIND_HOST` | `0.0.0.0` | LAN bind address (`off` disables LAN listener) |
| `LIMINAL_REMOTE_CLOUD_ORIGIN` | `https://www.vireondynamics.com` | Cloud relay base URL |

## Security notes

- Join tokens are ephemeral (not persisted across sidecar restart).
- View-only is the default; use `/remote control` only when you trust the guest device.
- Harness destructive approvals still appear in the mirrored UI — the guest clicks Approve/Deny in the real app surface.

## Limitations

- **Web** (`npm run web`) does not host pixel mirror sessions — desktop only.
- **Cloud** mirror is lower FPS than LAN (JPEG polling through Vireon).
- **Linux Wayland** may require `xdg-desktop-portal` permission for capture/input.
- Re-run `/remote` after sidecar restart (tokens are in-memory only).
