#!/usr/bin/env node
// Idempotent Discord server bootstrapper for the Vireon / Liminal community.
//
// Builds roles, categories, channels, and permission overwrites from the
// declarative SERVER spec below. Safe to run repeatedly — existing roles and
// channels (matched by name) are reused and updated in place, never duplicated.
//
// Usage:
//   npm i -D discord.js                       # one-time (not added to root deps)
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/setup-server.mjs
//   ... add --dry-run to print the plan without touching Discord.
//
// The bot must already be a member of the guild with the Administrator
// permission (or at least Manage Roles + Manage Channels). The token and guild
// id are read from the environment only — never hard-code them here.

import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DRY_RUN = process.argv.includes("--dry-run");

if (!TOKEN || !GUILD_ID) {
  console.error(
    "Missing env. Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.\n" +
      "  DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/discord/setup-server.mjs"
  );
  process.exit(1);
}

// --- Declarative server spec -------------------------------------------------
// Roles are created first so channel overwrites can reference them by name.
const ROLES = [
  { name: "Team", color: 0x5865f2, hoist: true, mentionable: true, admin: true },
  { name: "Customer", color: 0x57f287, hoist: true, mentionable: true },
  { name: "Contributor", color: 0xfee75c, hoist: true, mentionable: true },
];

// Permission helpers. `gatedTo` = only @everyone-denied, listed roles allowed.
const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;

// readonly: everyone can see, only Team can post.
// gated:    hidden from @everyone; visible to the named roles (+ Team).
// open:     visible and postable by everyone (default).
const SERVER = [
  {
    category: "WELCOME",
    channels: [
      { name: "welcome", mode: "readonly" },
      { name: "rules", mode: "readonly" },
      { name: "announcements", mode: "readonly" },
      { name: "start-here", mode: "readonly" },
    ],
  },
  {
    category: "LIMINAL",
    topic: "Open-source harness — community, help, contributions.",
    channels: [
      { name: "liminal-general", mode: "open" },
      { name: "help-and-support", mode: "open" },
      { name: "showcase", mode: "open" },
      { name: "contributing", mode: "open" },
      { name: "feature-requests", mode: "open" },
      { name: "releases", mode: "readonly" }, // webhook target for CI release notes
    ],
  },
  {
    category: "VIREON DYNAMIC",
    topic: "Commercial layer — plans, customers, billing.",
    channels: [
      { name: "vireon-general", mode: "open" },
      { name: "pricing-and-plans", mode: "readonly" },
      { name: "customers", mode: "gated", roles: ["Customer"] },
      { name: "billing-support", mode: "gated", roles: ["Customer"] },
    ],
  },
  {
    category: "COMMUNITY",
    channels: [
      { name: "introductions", mode: "open" },
      { name: "off-topic", mode: "open" },
      { name: "General", mode: "open", type: ChannelType.GuildVoice },
    ],
  },
  {
    category: "STAFF",
    gated: ["Team"], // whole category hidden from non-Team
    channels: [
      { name: "staff-chat", mode: "gated", roles: ["Team"] },
      { name: "mod-log", mode: "gated", roles: ["Team"] },
    ],
  },
];

// --- Runtime -----------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const log = (...a) => console.log(...a);
const tag = DRY_RUN ? "[dry-run]" : "[apply]";

client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    log(`Connected to "${guild.name}" (${guild.id}) ${tag}\n`);

    await guild.roles.fetch();
    await guild.channels.fetch();

    const everyone = guild.roles.everyone;
    const roleByName = new Map();

    // 1. Roles
    for (const spec of ROLES) {
      let role = guild.roles.cache.find((r) => r.name === spec.name);
      const perms = spec.admin ? [PermissionFlagsBits.Administrator] : [];
      if (!role) {
        log(`+ role  ${spec.name}`);
        if (!DRY_RUN) {
          role = await guild.roles.create({
            name: spec.name,
            colors: { primaryColor: spec.color },
            hoist: spec.hoist,
            mentionable: spec.mentionable,
            permissions: perms,
          });
        }
      } else {
        log(`= role  ${spec.name} (exists)`);
      }
      if (role) roleByName.set(spec.name, role);
    }

    const resolveOverwrites = (mode, roleNames = [], categoryGate) => {
      const ow = [];
      const allowedRoles = new Set(roleNames);
      // Team always gets access to gated things.
      if (mode === "gated" || categoryGate) allowedRoles.add("Team");

      if (mode === "gated" || categoryGate) {
        ow.push({ id: everyone.id, deny: [VIEW] });
        for (const rn of allowedRoles) {
          const r = roleByName.get(rn);
          if (r) ow.push({ id: r.id, allow: [VIEW, SEND] });
        }
      } else if (mode === "readonly") {
        ow.push({ id: everyone.id, deny: [SEND] });
        const team = roleByName.get("Team");
        if (team) ow.push({ id: team.id, allow: [SEND] });
      }
      // "open" => no overwrites; inherits guild defaults.
      return ow;
    };

    // 2. Categories + channels
    for (const cat of SERVER) {
      let parent = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === cat.category
      );
      const catOw = resolveOverwrites("open", cat.gated || [], !!cat.gated);
      if (!parent) {
        log(`+ cat   ${cat.category}`);
        if (!DRY_RUN) {
          parent = await guild.channels.create({
            name: cat.category,
            type: ChannelType.GuildCategory,
            permissionOverwrites: catOw,
          });
        }
      } else {
        log(`= cat   ${cat.category} (exists)`);
      }

      for (const ch of cat.channels) {
        const type = ch.type ?? ChannelType.GuildText;
        const exists = guild.channels.cache.find(
          (c) => c.name === ch.name && c.parentId === (parent?.id ?? null)
        );
        const ow = resolveOverwrites(ch.mode, ch.roles, !!cat.gated);
        if (!exists) {
          log(`  + chan ${cat.category} / ${ch.name} [${ch.mode}]`);
          if (!DRY_RUN) {
            await guild.channels.create({
              name: ch.name,
              type,
              parent: parent?.id,
              topic: type === ChannelType.GuildText ? cat.topic : undefined,
              permissionOverwrites: ow,
            });
          }
        } else {
          log(`  = chan ${cat.category} / ${ch.name} (exists)`);
        }
      }
    }

    log(`\nDone ${tag}.`);
  } catch (err) {
    console.error("Failed:", err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

client.login(TOKEN);
