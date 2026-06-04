#!/usr/bin/env node
// Provision the full community role set (governance + retention) and re-gate
// channels. Idempotent: existing roles are updated in place, missing ones are
// created, superseded roles are deleted. Channel gating is re-applied to the
// new Pro/Team Plan + staff roles.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/manage-roles.mjs
//   ... add --dry-run to preview.
//
// NOTE: Discord forbids a bot from positioning roles ABOVE its own integration
// role, so Founder/Admin may land below the bot's "Vireon Dynamics" role. The
// script orders what it can and prints the manual drag order for the rest.

import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DRY_RUN = process.argv.includes("--dry-run");
if (!TOKEN || !GUILD_ID) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

// Desired roles, highest → lowest.
const MOD_PERMS = [
  P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers,
  P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageNicknames,
];
const DESIRED = [
  { name: "Founder",       color: 0xf1c40f, hoist: true,  mentionable: false, perms: [P.Administrator] },
  { name: "Admin",         color: 0xe74c3c, hoist: true,  mentionable: false, perms: [P.Administrator] },
  { name: "Moderator",     color: 0x5865f2, hoist: true,  mentionable: true,  perms: MOD_PERMS },
  { name: "Core Team",     color: 0x7c3aed, hoist: true,  mentionable: true,  perms: [P.ManageMessages, P.ManageThreads, P.MentionEveryone] },
  { name: "Maintainer",    color: 0x1abc9c, hoist: true,  mentionable: true,  perms: [P.ManageThreads] },
  { name: "Pro",           color: 0xf59e0b, hoist: true,  mentionable: false, perms: [] },
  { name: "Team Plan",     color: 0xeb459e, hoist: true,  mentionable: false, perms: [] },
  { name: "Contributor",   color: 0x57f287, hoist: true,  mentionable: false, perms: [] },
  { name: "Helper",        color: 0x3498db, hoist: true,  mentionable: false, perms: [] },
  { name: "OG",            color: 0xe67e22, hoist: true,  mentionable: false, perms: [] },
  { name: "Regular",       color: 0x2ecc71, hoist: false, mentionable: false, perms: [] },
  { name: "Release Pings", color: 0x95a5a6, hoist: false, mentionable: true,  perms: [] },
  { name: "News & Events", color: 0x95a5a6, hoist: false, mentionable: true,  perms: [] },
  { name: "Bots",          color: 0x99aab5, hoist: false, mentionable: false, perms: [] },
];

// Old generic roles superseded by the set above.
const DELETE = ["Customer", "Team"];

const STAFF = ["Founder", "Admin", "Moderator", "Core Team"];
const SUBSCRIBER = ["Pro", "Team Plan"];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const log = (...a) => console.log(...a);
const tag = DRY_RUN ? "[dry-run]" : "[apply]";
const eq = (a, b) => a.toString() === b.toString();

client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    log(`Managing roles in "${guild.name}" ${tag}\n`);

    const byName = new Map();

    // 1. Create / update desired roles.
    for (const spec of DESIRED) {
      const permBits = spec.perms.reduce((acc, b) => acc | b, 0n);
      let role = guild.roles.cache.find((r) => r.name === spec.name);
      if (!role) {
        log(`+ role  ${spec.name}`);
        if (!DRY_RUN) {
          role = await guild.roles.create({
            name: spec.name,
            colors: { primaryColor: spec.color },
            hoist: spec.hoist,
            mentionable: spec.mentionable,
            permissions: permBits,
          });
        }
      } else {
        const needs =
          role.hoist !== spec.hoist ||
          role.mentionable !== spec.mentionable ||
          !eq(role.permissions.bitfield, permBits);
        log(`${needs ? "~" : "="} role  ${spec.name}${needs ? " (update)" : ""}`);
        if (needs && !DRY_RUN) {
          await role.edit({
            colors: { primaryColor: spec.color },
            hoist: spec.hoist,
            mentionable: spec.mentionable,
            permissions: permBits,
          });
        }
      }
      if (role) byName.set(spec.name, role);
    }

    // 2. Re-gate channels to the new roles (replaces existing overwrites).
    const everyone = guild.roles.everyone;
    const allowView = (names) => {
      const ow = [{ id: everyone.id, deny: [P.ViewChannel] }];
      for (const n of names) {
        const r = byName.get(n);
        if (r) ow.push({ id: r.id, allow: [P.ViewChannel, P.SendMessages] });
      }
      return ow;
    };
    const setOw = async (chName, names, types = [ChannelType.GuildText, ChannelType.GuildCategory]) => {
      const ch = guild.channels.cache.find((c) => c.name === chName && types.includes(c.type));
      if (!ch) return log(`? gate  ${chName} (not found)`);
      log(`~ gate  ${chName} → ${names.join(", ")}`);
      if (!DRY_RUN) await ch.permissionOverwrites.set(allowView(names));
    };

    // Subscriber lounges: Pro + Team Plan + staff.
    await setOw("customers", [...SUBSCRIBER, ...STAFF]);
    await setOw("billing-support", [...SUBSCRIBER, ...STAFF]);
    // Staff area: staff only.
    await setOw("STAFF", STAFF, [ChannelType.GuildCategory]);
    await setOw("staff-chat", STAFF);
    await setOw("mod-log", STAFF);

    // 3. Best-effort ordering (highest → lowest), below the bot's own role.
    try {
      const positions = DESIRED
        .map((d, i) => {
          const r = byName.get(d.name);
          return r ? { role: r.id, position: DESIRED.length - i } : null;
        })
        .filter(Boolean);
      if (!DRY_RUN && positions.length) await guild.roles.setPositions(positions);
      log(`~ order  applied (best-effort)`);
    } catch (e) {
      log(`! order  could not fully reorder (bot role limits): ${e.message}`);
    }

    // 4. Delete superseded roles.
    for (const name of DELETE) {
      const r = guild.roles.cache.find((x) => x.name === name);
      if (r) {
        log(`- role  ${name} (superseded)`);
        if (!DRY_RUN) await r.delete("superseded by new role set").catch((e) => log(`  (skip: ${e.message})`));
      }
    }

    log(`\nDone ${tag}.`);
    log("Manual step: drag **Founder/Admin** to the very top and the bot's");
    log("'Vireon Dynamics' role just below them — Discord blocks bots from");
    log("ordering roles above their own integration role.");
  } catch (err) {
    console.error("Failed:", err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});
client.login(TOKEN);
