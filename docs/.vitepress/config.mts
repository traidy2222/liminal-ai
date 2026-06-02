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
          { text: "Memory & recall", link: "/guides/memory-and-recall" },
          { text: "Web research", link: "/guides/web-research" },
          { text: "Browser automation", link: "/guides/browser-automation" },
          { text: "Document engine", link: "/guides/document-engine" },
          { text: "Voice (TTS & dictation)", link: "/guides/voice" },
          { text: "Sub-agents & orchestration", link: "/guides/sub-agents-and-orchestration" },
          { text: "Dynamic workflows", link: "/guides/dynamic-workflows" },
          { text: "Reasoning & effort", link: "/guides/reasoning-and-effort" },
          { text: "Tuning via Settings", link: "/guides/tuning-via-settings" },
          { text: "Running the eval suite", link: "/guides/running-eval" },
          { text: "Persona bootstrap", link: "/guides/persona-bootstrap" },
          { text: "Vault briefs & updates", link: "/guides/vault-briefs-and-updates" },
        ],
      },
      {
        text: "Pro & Enterprise",
        items: [
          { text: "Pro & Enterprise features", link: "/reference/pro-and-enterprise" },
          { text: "Accounts & licensing", link: "/guides/accounts-and-licensing" },
          { text: "Managed inference", link: "/guides/managed-inference" },
          { text: "Enterprise Edition", link: "/reference/enterprise-edition" },
          { text: "License", link: "/reference/license" },
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
