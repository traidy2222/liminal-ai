import { defineConfig } from "vitepress";

/** Local preview of docs/ (monorepo). Published site uses website/docs-portal. */
export default defineConfig({
  title: "Liminal",
  description: "Local-first agent harness documentation",
  srcDir: "..",
  outDir: ".vitepress/dist",
  cleanUrls: true,
  ignoreDeadLinks: [
    /^\.\.\//,
    /^\.\.\/\.\.\//,
    /^\.\.\/\.\.\/\.\.\//,
    /\/\.env\.example$/,
  ],
  themeConfig: {
    nav: [
      { text: "Install", link: "/start/install" },
      { text: "Quickstart", link: "/start/quickstart" },
      { text: "Troubleshooting", link: "/operations/troubleshooting" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install", link: "/start/install" },
          { text: "Quickstart", link: "/start/quickstart" },
          { text: "Configuration basics", link: "/start/configuration-basics" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Architecture", link: "/concepts/architecture" },
          { text: "Harness protocol", link: "/concepts/harness-protocol" },
          { text: "Runtime behavior", link: "/concepts/runtime-behavior" },
          { text: "Identity stack", link: "/concepts/identity-stack" },
          { text: "Memory and vault", link: "/concepts/memory-and-vault" },
          { text: "Persona system", link: "/concepts/persona-system" },
          { text: "UI streaming", link: "/concepts/ui-streaming" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Persona bootstrap", link: "/guides/persona-bootstrap" },
          { text: "Vault briefs & updates", link: "/guides/vault-briefs-and-updates" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Changelog", link: "/reference/changelog" },
          { text: "Roadmap", link: "/reference/roadmap" },
          { text: "Environment (generated)", link: "/reference/environment" },
          { text: "Web API", link: "/reference/web-api" },
          { text: "Events", link: "/reference/events" },
          { text: "Tool families", link: "/reference/tools/" },
          { text: "Configuration (narrative)", link: "/configuration" },
        ],
      },
      {
        text: "Operations",
        items: [
          { text: "Troubleshooting", link: "/operations/troubleshooting" },
          { text: "Profiles", link: "/operations/profiles" },
        ],
      },
    ],
    search: { provider: "local" },
  },
});
