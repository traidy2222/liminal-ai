#!/usr/bin/env node
// Seeds the Vireon / Liminal server with real content: channel topics, rich
// welcome/rules/orientation messages (pinned), pricing, per-channel intros, and
// cleanup of Discord's default channels. Idempotent — channels already seeded
// (detected via the SEED_MARKER footer) are skipped; topics are always synced.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord/seed-content.mjs
//   ... add --dry-run to print actions without writing.
//
// Bot needs: Manage Channels, Manage Messages (for pins), Send Messages.

import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DRY_RUN = process.argv.includes("--dry-run");
if (!TOKEN || !GUILD_ID) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const SEED_MARKER = "vireon-seed-v1";
const BRAND = 0x7c3aed; // Liminal purple
const GREEN = 0x22c55e;
const GOLD = 0xfee75c;

const SITE = "https://www.vireondynamics.com/liminal";
const GET_STARTED = "https://www.vireondynamics.com/liminal/get-started";
const PRICING = "https://www.vireondynamics.com/liminal/pricing";
const DOCS = "https://docs.vireondynamics.com/liminal/";
const REPO = "https://github.com/traidy2222/liminal-ai";
const CHANGELOG = "https://www.vireondynamics.com/liminal/changelog";

const footer = { text: SEED_MARKER };

// Delete Discord's auto-created starter channels/categories.
const DELETE_CATEGORIES = ["Text Channels", "Voice Channels"];

// Per-channel: topic (always synced) + optional message to post once & pin.
const CONTENT = {
  welcome: {
    topic: "Welcome to the Vireon Dynamics community — home of Liminal AI.",
    pin: true,
    embed: {
      color: BRAND,
      title: "👋 Welcome to Vireon Dynamics",
      description:
        "This is the community home for **Liminal AI** — a fair-source ReAct coding agent you run on **your own machine**. Any OpenAI-compatible model, 140+ tools, terminal + web UI, full visibility into every tool call and approval.\n\n" +
        "**New here?** Head to **#start-here** for a 60-second tour and the channel guide.",
      fields: [
        { name: "🚀 Install (90s)", value: `[Get started →](${GET_STARTED})`, inline: true },
        { name: "📚 Docs", value: `[Read the docs →](${DOCS})`, inline: true },
        { name: "⭐ Source", value: `[GitHub →](${REPO})`, inline: true },
      ],
      footer,
    },
  },
  rules: {
    topic: "Community guidelines. Read before posting.",
    pin: true,
    embed: {
      color: BRAND,
      title: "📜 Community Rules",
      description:
        "**1. Be respectful.** No harassment, hate, or personal attacks.\n" +
        "**2. Stay on topic.** Use the right channel — keep chatter in #off-topic.\n" +
        "**3. No spam or unsolicited self-promo.** Showcase belongs in #showcase.\n" +
        "**4. No piracy or license circumvention.** Liminal CE is fair-source (FSL-1.1-MIT); respect it.\n" +
        "**5. Never share secrets.** Don't paste API keys, tokens, or `.env` contents — redact first.\n" +
        "**6. Search before asking.** Check #help-and-support history and the docs.\n" +
        "**7. Follow Discord ToS** and local law.\n\n" +
        "Staff may remove content or members at their discretion. Questions about moderation → DM a **Team** member.",
      footer,
    },
  },
  "start-here": {
    topic: "New here? Orientation, channel guide, and roles.",
    pin: true,
    embed: {
      color: GREEN,
      title: "🧭 Start Here",
      description:
        "Welcome! Here's how the server is laid out and how to get going.",
      fields: [
        {
          name: "🟣 LIMINAL (open community)",
          value:
            "**#liminal-general** — general chat\n**#help-and-support** — get unstuck\n**#showcase** — show what you built\n**#contributing** — PRs & dev setup\n**#feature-requests** — ideas\n**#releases** — version notes",
        },
        {
          name: "🟢 VIREON DYNAMIC (the commercial layer)",
          value:
            "**#vireon-general** — Pro/Team chat\n**#pricing-and-plans** — editions\n**#customers** / **#billing-support** — unlocked by the **Customer** role",
        },
        {
          name: "🎭 Roles",
          value:
            "**Team** — staff/admins\n**Customer** — Pro/Team subscribers (unlocks Vireon support)\n**Contributor** — active contributors\nAsk a **Team** member to grant Contributor, or post a PR in #contributing.",
        },
        {
          name: "▶️ First steps",
          value: `1. Read **#rules**\n2. Say hi in **#introductions**\n3. [Install Liminal in 90s →](${GET_STARTED})`,
        },
      ],
      footer,
    },
  },
  announcements: {
    topic: "Official announcements from the Vireon Dynamics team.",
    pin: true,
    embed: {
      color: BRAND,
      title: "🎉 The community is live!",
      description:
        `Welcome to the official **Vireon Dynamics / Liminal AI** Discord.\n\n` +
        `Whether you run Community Edition locally or you're on Pro/Team, this is the place for help, ideas, and release news.\n\n` +
        `**Latest release:** Liminal 0.0.17 — team shared memory & cloud sync. [Changelog →](${CHANGELOG})\n\n` +
        `Grab the latest, drop an intro in **#introductions**, and let us know what you're building. 🚀`,
      footer,
    },
  },
  "liminal-general": {
    topic: "General chat about Liminal AI — usage, models, tips, the harness.",
    pin: true,
    embed: {
      color: BRAND,
      title: "💬 Liminal General",
      description:
        "The main hangout for everything Liminal — model choices, harness behavior, workflows, tips, wins, and gripes. For specific help use **#help-and-support**; to show off a build use **#showcase**.",
      footer,
    },
  },
  "help-and-support": {
    topic: "Stuck? Ask here. Include OS, Node version, command, and the error.",
    pin: true,
    embed: {
      color: GREEN,
      title: "🛟 How to get help fast",
      description:
        "Before posting, check the docs and search this channel. When you ask, include:",
      fields: [
        { name: "Environment", value: "OS, Node version (`node -v`), Liminal version", inline: false },
        { name: "What you ran", value: "The exact command or action", inline: false },
        { name: "What happened", value: "Full error text (redact any keys/tokens!) and what you expected", inline: false },
        { name: "Resources", value: `[Docs](${DOCS}) · [Troubleshooting](https://docs.vireondynamics.com/liminal/operations/troubleshooting) · [GitHub issues](${REPO}/issues)`, inline: false },
      ],
      footer,
    },
  },
  showcase: {
    topic: "Show what you built with Liminal — projects, workflows, personas.",
    pin: true,
    embed: {
      color: GOLD,
      title: "✨ Showcase",
      description:
        "Built something with Liminal? Share it! Screenshots, repos, personas, workflows, demos — all welcome. A short blurb on what it does and which tools/models you used goes a long way.",
      footer,
    },
  },
  contributing: {
    topic: "Contribute to Liminal — PRs, issues, dev setup, invariants.",
    pin: true,
    embed: {
      color: BRAND,
      title: "🛠️ Contributing",
      description:
        "Liminal is open-core and PRs are welcome on the Community Edition.",
      fields: [
        { name: "Repo", value: `[github.com/traidy2222/liminal-ai](${REPO})`, inline: false },
        { name: "Build order", value: "`core` → `tools` before `tui`/`web`/`eval`. Keep `core` free of `tools` imports.", inline: false },
        { name: "Before a PR", value: "Run `npm run typecheck` and `npm run test`. See `CLAUDE.md` / `AGENTS.md` for invariants.", inline: false },
        { name: "Get the Contributor role", value: "Open a PR or ask a Team member here.", inline: false },
      ],
      footer,
    },
  },
  "feature-requests": {
    topic: "Suggest features and improvements. One idea per post.",
    pin: true,
    embed: {
      color: GOLD,
      title: "💡 Feature Requests",
      description:
        "Have an idea? Post it here — one idea per message so others can react 👍 to signal interest. Describe the problem you're hitting, not just the solution. Bigger proposals can also go to [GitHub issues](" + REPO + "/issues).",
      footer,
    },
  },
  releases: {
    topic: "Release notes and version announcements (read-only).",
    pin: true,
    embed: {
      color: GREEN,
      title: "📦 Liminal 0.0.17 — team shared memory & cloud sync",
      description:
        "• **Team shared memory** — workspace/global notes sync across org members on the same repo fingerprint\n" +
        "• **Org admin** — members, invites, audit log, fleet/policy\n" +
        "• **Pro cloud sync** APIs on the control plane\n\n" +
        `Full changelog → ${CHANGELOG}`,
      footer,
    },
  },
  "vireon-general": {
    topic: "Vireon Dynamics — the studio behind Liminal. Pro/Team discussion.",
    pin: true,
    embed: {
      color: BRAND,
      title: "🏢 Vireon Dynamics",
      description:
        "Vireon Dynamics is the AI-infrastructure studio (Australia) behind Liminal. Liminal **Community Edition is free on your machine**; **Pro** and **Team** add cloud sync, org admin, and shared memory. Talk Pro/Team here — see **#pricing-and-plans** for editions.",
      footer,
    },
  },
  "pricing-and-plans": {
    topic: "Liminal editions: Community (free), Pro, Team.",
    pin: true,
    embed: {
      color: BRAND,
      title: "💳 Liminal editions",
      fields: [
        { name: "🆓 Community", value: "Free, runs on your machine. The full harness — 140+ tools, TUI + web, any OpenAI-compatible model. FSL-1.1-MIT.", inline: false },
        { name: "⭐ Pro", value: "Adds cloud sync for your memory/notes across machines.", inline: false },
        { name: "👥 Team", value: "Org admin, member invites, audit log, and shared memory across your org.", inline: false },
      ],
      description: `See full pricing & checkout → ${PRICING}`,
      footer,
    },
  },
  customers: {
    topic: "Customer-only lounge for Pro/Team subscribers.",
    pin: true,
    embed: {
      color: GREEN,
      title: "💚 Welcome, customers!",
      description:
        "Thanks for supporting Liminal. This space is just for **Pro/Team** subscribers — priority discussion, early notes, and direct line to the team. Billing issues → **#billing-support**.",
      footer,
    },
  },
  "billing-support": {
    topic: "Billing, licensing, and account help for subscribers.",
    pin: true,
    embed: {
      color: GREEN,
      title: "🧾 Billing & licensing support",
      description:
        "Questions about subscriptions, invoices, license keys, or seats? Post here and a Team member will help. **Never paste full license keys or payment details** — share the last 4 digits / a screenshot with secrets redacted.\n\n" +
        "Manage your subscription → https://www.vireondynamics.com/account/organization",
      footer,
    },
  },
  introductions: {
    topic: "Introduce yourself! Who you are and what you're building.",
    pin: true,
    embed: {
      color: GOLD,
      title: "👋 Introduce yourself",
      description:
        "Drop a quick intro:\n• **Name / handle**\n• **What you build**\n• **How you found Liminal**\n• **What you want to use it for**\n\nWelcome aboard!",
      footer,
    },
  },
  "off-topic": {
    topic: "Anything goes (within the rules). Non-Liminal chatter welcome.",
  },
  "staff-chat": {
    topic: "Private Team coordination.",
  },
  "mod-log": {
    topic: "Moderation log.",
  },
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const log = (...a) => console.log(...a);
const tag = DRY_RUN ? "[dry-run]" : "[apply]";

const alreadySeeded = async (channel) => {
  try {
    const msgs = await channel.messages.fetch({ limit: 25 });
    return msgs.some(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds.some((e) => e.footer?.text === SEED_MARKER)
    );
  } catch {
    return false;
  }
};

client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    log(`Seeding "${guild.name}" ${tag}\n`);

    // 1. Delete Discord's default starter channels/categories.
    for (const catName of DELETE_CATEGORIES) {
      const cat = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === catName
      );
      if (!cat) continue;
      const children = guild.channels.cache.filter((c) => c.parentId === cat.id);
      for (const child of children.values()) {
        log(`- del  #${child.name} (default)`);
        if (!DRY_RUN) await child.delete("default starter channel");
      }
      log(`- del  [${catName}] (default category)`);
      if (!DRY_RUN) await cat.delete("default starter category");
    }

    // 2. System (join) messages → #welcome.
    const welcome = guild.channels.cache.find(
      (c) => c.name === "welcome" && c.type === ChannelType.GuildText
    );
    if (welcome && guild.systemChannelId !== welcome.id) {
      log(`~ set system (join) channel → #welcome`);
      if (!DRY_RUN) await guild.setSystemChannel(welcome.id, "route join messages");
    }

    // 3. Per-channel topics + seed messages.
    for (const [name, spec] of Object.entries(CONTENT)) {
      const ch = guild.channels.cache.find(
        (c) => c.name === name && c.type === ChannelType.GuildText
      );
      if (!ch) {
        log(`? skip #${name} (not found)`);
        continue;
      }
      if (spec.topic && ch.topic !== spec.topic) {
        log(`~ topic #${name}`);
        if (!DRY_RUN) await ch.setTopic(spec.topic);
      }
      if (spec.embed) {
        if (await alreadySeeded(ch)) {
          log(`= msg   #${name} (already seeded)`);
        } else {
          log(`+ msg   #${name}${spec.pin ? " (+pin)" : ""}`);
          if (!DRY_RUN) {
            const sent = await ch.send({ embeds: [spec.embed] });
            if (spec.pin) await sent.pin().catch(() => {});
          }
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
