#!/usr/bin/env node
// Create (or reuse) a permanent, unlimited-use invite to the server, landing on
// #welcome. Prints the invite URL. Reuses an existing never-expiring invite if
// one already points at #welcome, so re-running doesn't pile up invites.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/invite.mjs
//
// Bot needs: Create Instant Invite (+ Manage Guild to list existing invites).
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN || !GUILD_ID) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    const landing =
      guild.channels.cache.find(
        (c) => c.name === "welcome" && c.type === ChannelType.GuildText
      ) ||
      guild.channels.cache.find((c) => c.type === ChannelType.GuildText);
    if (!landing) throw new Error("No text channel to anchor the invite.");

    // Reuse an existing permanent (maxAge 0) invite on the landing channel.
    let existing;
    try {
      const invites = await guild.invites.fetch();
      existing = invites.find(
        (i) => i.channelId === landing.id && i.maxAge === 0 && i.maxUses === 0
      );
    } catch {
      /* needs Manage Guild; fall through to create */
    }

    const invite =
      existing ||
      (await landing.createInvite({
        maxAge: 0, // never expires
        maxUses: 0, // unlimited
        unique: false,
        reason: "Permanent community invite",
      }));

    console.log(`Invite (${existing ? "reused" : "created"}): ${invite.url}`);
  } catch (err) {
    console.error("Failed:", err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});
client.login(TOKEN);
