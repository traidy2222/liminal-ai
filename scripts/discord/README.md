# Discord server setup

Idempotent bootstrapper for the **Vireon / Liminal** community server.
Builds roles, categories, channels, and permission gating from the declarative
`SERVER` spec in `setup-server.mjs`. Re-running is safe — anything that already
exists (matched by name) is reused, never duplicated.

## One-time prerequisites

1. **Create the server** in Discord. Enable Developer Mode (Settings → Advanced),
   then right-click the server icon → **Copy Server ID**.
2. **Create a bot**: <https://discord.com/developers/applications> → New
   Application → **Bot** → Reset Token (copy it; keep it secret).
3. **Invite the bot** via OAuth2 → URL Generator: scopes `bot` +
   `applications.commands`, bot permission **Administrator**. Open the URL and
   add it to your server.

## Scripts

| Script              | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `setup-server.mjs`  | Creates roles, categories, channels, and permission gating (idempotent).     |
| `seed-content.mjs`  | Sets channel topics, posts + pins welcome/rules/orientation/pricing embeds, deletes Discord's default channels, routes join messages to `#welcome` (idempotent). |
| `invite.mjs`        | Creates/reuses a permanent, unlimited-use invite and prints the URL.         |
| `inspect.mjs`       | Read-only dump of current roles + channel tree.                              |

Run order for a fresh server: `setup-server` → `seed-content` → `invite`.

## Run

```bash
npm i -D discord.js   # not added to root deps; install on demand

# Preview without touching Discord (setup + seed support --dry-run):
DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/setup-server.mjs --dry-run
DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/seed-content.mjs --dry-run

# Apply:
DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/setup-server.mjs
DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/seed-content.mjs
DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/invite.mjs
```

On Windows PowerShell:

```powershell
$env:DISCORD_BOT_TOKEN="xxx"; $env:DISCORD_GUILD_ID="123"; node scripts/discord/setup-server.mjs --dry-run
```

The token and guild id are read **only** from the environment — never commit them.

## What it creates

| Category        | Channels                                                              | Gating                          |
| --------------- | --------------------------------------------------------------------- | ------------------------------- |
| WELCOME         | welcome, rules, announcements, start-here                             | read-only (Team posts)          |
| LIMINAL         | general, help-and-support, showcase, contributing, feature-requests, releases | public (releases read-only) |
| VIREON DYNAMIC  | general, pricing-and-plans, customers, billing-support                | customers/billing → `Customer`  |
| COMMUNITY       | introductions, off-topic, General (voice)                             | public                          |
| STAFF           | staff-chat, mod-log                                                   | whole category → `Team`         |

**Roles:** `Team` (admin), `Customer` (unlocks Vireon support), `Contributor`.

Edit the `ROLES` / `SERVER` arrays in `setup-server.mjs` and re-run to change the
layout — additions appear, existing items are left in place.
