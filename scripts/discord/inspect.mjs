#!/usr/bin/env node
// Read-only: dump the guild's current roles and channel tree.
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/inspect.mjs
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
    await guild.roles.fetch();
    await guild.channels.fetch();

    console.log(`Guild: ${guild.name} (${guild.id})`);
    console.log(`Owner: ${guild.ownerId}  Members: ${guild.memberCount}\n`);

    console.log("Roles (top → bottom):");
    [...guild.roles.cache.values()]
      .sort((a, b) => b.position - a.position)
      .forEach((r) => console.log(`  ${r.position.toString().padStart(2)}  ${r.name}`));

    console.log("\nChannels:");
    const cats = [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.position - b.position);
    const orphans = [...guild.channels.cache.values()].filter(
      (c) => c.type !== ChannelType.GuildCategory && !c.parentId
    );
    for (const o of orphans) console.log(`  (no category) #${o.name}`);
    for (const cat of cats) {
      console.log(`  [${cat.name}]`);
      [...guild.channels.cache.values()]
        .filter((c) => c.parentId === cat.id)
        .sort((a, b) => a.position - b.position)
        .forEach((c) =>
          console.log(`     #${c.name}  (${ChannelType[c.type]})`)
        );
    }
  } catch (err) {
    console.error("Failed:", err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});
client.login(TOKEN);
