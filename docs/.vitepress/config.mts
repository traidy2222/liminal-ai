import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Liminal",
  description: "Local-first agent harness documentation",
  srcDir: ".",
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
      { text: "Home", link: "/" },
      { text: "Quickstart", link: "/start/quickstart" },
      { text: "Configuration", link: "/start/configuration-basics" },
      { text: "Troubleshooting", link: "/operations/troubleshooting" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
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
          { text: "Research (web)", link: "/guides/research-with-web-tools" },
          { text: "Vault briefs", link: "/guides/vault-briefs-and-updates" },
          { text: "Settings modal", link: "/guides/tuning-via-settings" },
          { text: "Persona bootstrap", link: "/guides/persona-bootstrap" },
          { text: "Running eval", link: "/guides/running-eval" },
          { text: "Writing large files", link: "/guides/writing-large-files" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Environment (generated)", link: "/reference/environment" },
          { text: "Web API", link: "/reference/web-api" },
          { text: "Events", link: "/reference/events" },
          { text: "Tool families", link: "/reference/tools/index" },
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
