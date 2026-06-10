# Local-First Knowledge Bases for Developers: Obsidian vs Logseq vs Plain Markdown + Git

**Date:** 2026-06-07  
**Scope:** Solo developer, daily coding workflow, local-first ownership

---

## Executive Summary

Three paths to a local-first personal knowledge base — and they diverge fast once you look past the "stores plain markdown" headline.

**Obsidian** gives you a polished, page-centric platform with a 1500+ plugin ecosystem and a 2026 CLI that lets you script vault operations from the terminal. Cost: Sync is $5–10/mo, and plugin maintenance can become its own job.

**Logseq** is free, open-source, and block-centric — an outliner built around daily journals. Built-in task management and PDF annotation mean less plugin hunting, but the mobile experience is weaker and the DB rewrite is still maturing.

**Plain markdown + git** is the zero-dependency option. VS Code as editor, git for versioning and sync, and your choice of sync tooling (rsync, cron to S3, or just `git push`). No plugins, no lock-in, no cost — but no graph view, no mobile app, and full-text search requires workarounds.

**For a solo developer who codes daily:** Obsidian wins if you'll use the CLI and want rich linking + graph visualization. Plain markdown + git wins if you want minimum friction, maximum portability, and already live in a terminal. Logseq is the right call only if outlining *is* how you think and you want everything free.

---

## Comparison Table

| Dimension | Obsidian | Logseq | Plain Markdown + Git |
|---|---|---|---|
| **Philosophy** | Page-centric; folders + links | Block-centric outliner; daily journal | Files + folders; editor-agnostic |
| **Sync** | Obsidian Sync ($5–10/mo), or iCloud/Dropbox/Syncthing/Git | Logseq Sync beta (~$3/mo), or Git/Syncthing | `git push`/`pull`; rsync; cron to cloud storage |
| **Plugins** | 1500+ community plugins; Dataview, Templater, Kanban | Smaller ecosystem; core app covers tasks, flashcards, PDF | None required; VS Code extensions for markdown, search, LLM |
| **Search** | Fast built-in; CLI search; Dataview queries | Good within blocks; query language built-in | VS Code (exact match); git grep; or external engine (Lucene/LLM) |
| **Mobile** | Native apps (iOS, Android); full plugin support | Electron-based; limited plugin support; heavier | No dedicated app; any markdown editor or git client on mobile |
| **Lock-in** | Low: plain `.md` files on disk. Plugin-specific syntax (Dataview queries) is the only friction | Low but not zero: `.md` files but block-refs use Logseq-specific syntax; DB version may change this | Near-zero: standard `.md` files; git is universal |
| **Performance** | Good at scale (thousands of notes); graph slows with huge vaults | Can struggle with very large graphs; DB version aims to fix this | Unlimited — scales to any filesystem size |
| **Developer UX** | CLI (2026): create, search, diff, eval JS, devtools. Scriptable. Git-friendly. | Git-friendly. No CLI. Open-source means you can fork/fix. | Native: bash scripts, git hooks, VS Code tasks, LLM copilot integration |
| **Cost** | Free for personal. Sync: $5–10/mo. Catalyst: $25 one-time (CLI access currently). Commercial: $50/user/yr. | Free (open-source). Sync beta ~$3/mo. | Free. |
| **Collaboration** | Real-time collaboration (2026). Git workflows for teams. | RTC in DB version (in development). No official team sync. | Git = built-in collaboration. PR-based workflows. Merge conflicts possible on `.md`. |

---

## Deep Dive

### Obsidian: The Platform

Obsidian is the incumbent for a reason. It's polished, extensible, and the 2026 CLI genuinely changes the calculus for developers. You can now script vault operations — create daily notes from cron, search across thousands of files, diff versions, run `eval` against the app's JS console — without touching a plugin. This moves Obsidian from "a very good notes app" to "a programmable knowledge platform."

The plugin ecosystem is unmatched. Dataview turns your vault into a queryable database. Templater automates note creation. Kanban gives you boards. But there's a real cost: plugin maintenance. As the dev.to post put it: "Obsidian was great until it wasn't." Plugins break on updates, sync between devices can miss plugin settings, and the whole thing can start to feel like maintaining a small software project — which, for a developer, is either a feature or the exact thing you're trying to escape.

Sync is the other friction point. Obsidian Sync works well for notes but has known issues with plugin settings and hotkeys across devices. Third-party sync (iCloud, Syncthing, git) works but you're on your own. At $5–10/mo, Sync is reasonable but not free — and if you're already paying for GitHub, the "free sync via git" comparison becomes real.

**Key strength for developers:** The CLI. `obsidian search query="TODO"`, `obsidian diff file=README from=1 to=3`, `obsidian eval code="app.vault.getFiles().length"`. This is what makes Obsidian a tool rather than a walled garden.

### Logseq: The Outliner

Logseq is the open-source, free-forever alternative. Its core insight — that most knowledge work starts as fragments, not finished documents — maps well to how developers actually take notes: quick captures, bullet points, nested hierarchies. The daily journal is the default entry point, and block-level referencing means you can link to a single bullet anywhere in your graph.

Built-in features are Logseq's strongest argument: task management (TODO/DOING/DONE with deadlines), PDF annotation, flashcards, and a query language — all without plugins. For students or researchers, this is a genuine time-saver. For developers, it means less time configuring and more time working.

But Logseq's weaknesses are structural. The mobile app is Electron-based and feels heavy. Performance with large graphs (thousands of notes) can degrade. The current DB rewrite (Logseq DB version) promises to fix sync and performance but is still in development — and until it ships, the platform is in a transitional state. Block references use Logseq-specific syntax, so while your files *are* markdown, portability isn't quite as clean as Obsidian's flat `.md` files.

Sync is a work in progress. The beta sync service (~$3/mo) is new. Git + Syncthing remain the pragmatic fallback — and if you're already using git, the question becomes: why not just use plain markdown and skip the app entirely?

**Key strength for developers:** Open-source means you own the stack. If something breaks, you can fix it. And the outliner mental model, if it clicks for you, is genuinely faster for daily capture than any page-based system.

### Plain Markdown + Git: The Developer's Default

This isn't an "app" — it's a workflow. Markdown files in a directory, edited in VS Code (or any editor), versioned with git, synced however you already sync code. Three backup strategies emerge naturally: git push, rsync to a second machine, cron to cloud storage. The Dichen Li account (Medium) lays it out cleanly: security compliance, zero lock-in, and the same tools you already use for code.

The tradeoffs are real. No graph view — if you want bidirectional links, you're writing `[[wikilinks]]` by hand and using grep to find backlinks. No mobile app — you can read `.md` files on a phone, but there's no polished capture experience. Full-text search requires workarounds: VS Code is exact-match only, so you might use IntelliJ, a markdown search extension, macOS Finder, or an LLM copilot (Amazon Q, Copilot, Claude) pointed at your notes directory.

But here's the thing developers consistently report: the friction is lower than it sounds. You already have git. You already have VS Code. You already know how to write shell scripts. Adding a notes directory to your existing workflow costs almost nothing. And LLM copilot integration — point a model at your notes directory and ask questions — turns a static file tree into something that feels like semantic search without any RAG infrastructure.

The hidden advantage: **composability**. Your notes are just files. Want to run a script that extracts all TODOs across every project note? `grep -r "TODO" .` Done. Want to pipe your daily notes into an LLM summarizer? `cat daily/2026-06-07.md | llm "summarize key decisions"`. No plugin API to learn, no app that has to be running — just files and tools you already own.

**Key strength for developers:** Zero dependency. Maximum portability. Git-native collaboration. LLM-ready by default.

---

## Recommendation for a Solo Developer Who Codes Daily

**If you'll actually use the CLI and want rich linking + graph visualization:** Obsidian.

The 2026 CLI closes the gap between "notes app" and "developer tool." You can script vault operations, integrate with CI, run diffs, and automate repetitive tasks. The plugin ecosystem gives you Dataview (SQL-like queries over your notes), which is genuinely useful for a developer tracking bugs, ideas, or project notes. The graph view is a real cognitive aid once you have hundreds of interconnected notes — it surfaces patterns you'd never find with grep.

But be honest with yourself: will you maintain the plugins? Will you pay for Sync or set up a git-based alternative? If the answer to either is "no" or "I already resent having another thing to maintain," then Obsidian's overhead will grate.

**If you want minimum friction, maximum portability, and already live in a terminal:** Plain markdown + git.

This is the "it just works" option for developers. No app to install. No plugins to update. No sync service to pay for. Your notes live alongside your code, versioned the same way, searchable with the same tools. Add an LLM copilot pointed at your notes directory and you have semantic Q&A without any infrastructure. The only real loss is the graph view — and for many developers, `grep` and git log are more useful than a pretty visualization anyway.

**Logseq** is the right call only if outlining is *how you think* — if you genuinely prefer bullet-point hierarchies over documents, if daily journaling is your primary capture mode, and if "free and open-source" is non-negotiable. For most developers, the weaker mobile experience and transitional DB architecture make it a harder sell in 2026 than either Obsidian or plain markdown.

---

## Sources Cited

1. **Logseq vs Obsidian: Which Is Better in 2026?** — ProductivityStack  
   https://productivitystack.io/compare/logseq-vs-obsidian/  
   *Head-to-head comparison scoring Obsidian 9/10 and Logseq 8.4/10, with detailed feature matrix and pricing breakdown.*

2. **Obsidian vs Logseq: Choosing a Note-Taking App** — OpenReplay Blog  
   https://blog.openreplay.com/obsidian-vs-logseq-note-taking-app/  
   *Deep technical comparison emphasizing plugin ecosystems (1500+ for Obsidian), performance at scale, and the page-vs-block mental model.*

3. **Why I switched from Obsidian: A real developer's story** — DEV Community  
   https://dev.to/dev_tips/why-i-switched-from-obsidian-a-real-developers-story-and-what-im-using-now-ndn  
   *First-person account of leaving Obsidian due to sync issues, plugin maintenance burden, and cost — migrated to a simpler markdown-based workflow.*

4. **Obsidian vs Logseq: which should you choose in 2026?** — Fabric  
   https://fabric.so/comparison/obsidian-vs-logseq  
   *Updated May 2026 comparison focusing on Logseq's DB version transition, Obsidian's CLI, and the core mental-model difference.*

5. **Logseq vs Obsidian in 2026: Which One Should You Actually Use?** — Christian Grech, Medium  
   https://christiangrech.medium.com/logseq-vs-obsidian-in-2026-which-one-should-you-actually-use-de08b0c35075  
   *Practical comparison from a 5-month daily Logseq user, covering task management, travel tracking, and life-system building.*

6. **My notes taking app story with markdown, git, VS Code and LLM** — Dichen Li, AI Advances  
   https://ai.gopubby.com/my-notes-taking-app-story-with-markdown-git-vs-code-and-llm-84ccb3b94354  
   *Developer walkthrough of a plain-markdown + git workflow: three backup strategies, VS Code configuration, and LLM copilot integration for semantic search.*

7. **Obsidian CLI — Official Documentation** — Obsidian Help  
   https://obsidian.md/help/cli  
   *Complete CLI reference: vault operations, search, diff, daily notes, task management, developer commands (eval, devtools, screenshots), and TUI.*

8. **Obsidian CLI is the new best way to automate your notes** — XDA Developers  
   https://www.xda-developers.com/obsidian-cli-is-the-new-best-way-to-automate-your-notes/  
   *Practical CLI examples (scheduled note creation, tag migration scripts) and assessment of CLI vs plugins; notes CLI currently requires Catalyst license.*

---

*Report compiled 2026-06-07. All URLs accessed same date.*