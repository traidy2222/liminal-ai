#!/usr/bin/env node
// Assign roles to specific members by user ID. Idempotent — skips roles the
// member already has. Single-member fetch uses REST, so no privileged intent.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/assign-roles.mjs
//   ... add --dry-run to preview.
//
// The bot can only assign roles BELOW its own highest (integration) role.
import { Client, GatewayIntentBits } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DRY_RUN = process.argv.includes("--dry-run");
if (!TOKEN || !GUILD_ID) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const ASSIGN = [
  { userId: "725170172494872618", roles: ["Founder", "OG"] },     // owner
  { userId: "1511866198789193811", roles: ["Bots"] },             // the bot
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const tag = DRY_RUN ? "[dry-run]" : "[apply]";

client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();
    console.log(`Assigning roles in "${guild.name}" ${tag}\n`);

    for (const { userId, roles } of ASSIGN) {
      let member;
      try {
        member = await guild.members.fetch(userId);
      } catch {
        console.log(`? ${userId} — member not found (have they joined?)`);
        continue;
      }
      for (const name of roles) {
        const role = guild.roles.cache.find((r) => r.name === name);
        if (!role) {
          console.log(`  ? ${name} — role not found`);
          continue;
        }
        if (member.roles.cache.has(role.id)) {
          console.log(`  = ${member.user.tag} already has ${name}`);
          continue;
        }
        console.log(`  + ${member.user.tag} → ${name}`);
        if (!DRY_RUN) {
          try {
            await member.roles.add(role, "role assignment script");
          } catch (e) {
            console.log(`    (failed: ${e.message})`);
          }
        }
      }
    }
    console.log(`\nDone ${tag}.`);
  } catch (err) {
    console.error("Failed:", err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});
client.login(TOKEN);
