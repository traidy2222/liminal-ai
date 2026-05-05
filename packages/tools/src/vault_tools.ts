/**
 * Obsidian-compatible vault tools — the agent's rich knowledge brain.
 *
 * 7 tools:
 *   vault_write    — create / update a markdown note with frontmatter
 *   vault_read     — read a note and show its backlinks
 *   vault_search   — full-text search across the vault
 *   vault_list     — browse notes with type/tag filtering
 *   vault_links    — show forward links + backlinks for a note
 *   vault_graph    — BFS knowledge-graph traversal
 *   vault_delete   — permanently remove a note
 */

import { defineTool } from "./helpers.js";
import type { NoteType } from "./vault_store.js";
import {
  writeVaultNote,
  findNote,
  searchVault,
  findNearDuplicateNote,
  listAllNotes,
  getBacklinks,
  deleteVaultNote,
  traverseGraph,
  extractWikilinks,
  titleToSlug,
  getVaultDir,
} from "./vault_store.js";
import { suggestWikilinkLine } from "./memory_autolink.js";

// ─── vault_write ──────────────────────────────────────────────────────────────

export const vaultWriteTool = defineTool({
  name: "vault_write",
  description:
    "WHAT: Write a rich Obsidian-compatible markdown note to the knowledge vault.\n" +
    "WHEN: Storing anything longer than 2 sentences, structured knowledge, or info that\n" +
    "connects to other concepts. Use [[Wikilinks]] in the body to link related notes.\n" +
    "TYPES: fact (persistent constants/preferences), entity (project/file/person summaries),\n" +
    "reflection (failure lessons), recipe (successful patterns), task (work-in-progress\n" +
    "state), note (general research or observations), episode (auto session chunks).\n" +
    "Prefer vault_write() over remember() for richer, linked, or longer content.\n" +
    "ARGS: title — note title (lookup key); content — markdown body with [[Wikilinks]];\n" +
    "type — note type; tags — optional string array.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Note title — used as the lookup key and Obsidian filename",
      },
      content: {
        type: "string",
        description:
          "Markdown body. Use [[Wikilinks]] to connect related notes. " +
          "Headers, lists, and code blocks are all supported.",
      },
      type: {
        type: "string",
        enum: ["fact", "entity", "reflection", "recipe", "task", "note", "episode"],
        description: "Note type — determines vault subfolder",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags for filtering and graph coloring in Obsidian",
      },
    },
    required: ["title", "content", "type"],
    additionalProperties: false,
  },
  handler: async (args) => {
    try {
      let body = args["content"] as string;
      const title = args["title"] as string;
      const typ = args["type"] as NoteType;
      if (process.env["AGENT_VAULT_DEDUPE"] === "1") {
        const dupes = await findNearDuplicateNote(title, body, { limit: 3, threshold: 0.5 });
        if (dupes.length > 0) {
          const best = dupes[0]!;
          return {
            ok: false,
            error:
              `Near-duplicate vault note detected: [[${best.note.title}]] score=${best.score.toFixed(3)}. ` +
              `Search/update existing note instead of creating a new duplicate.`,
          };
        }
      }

      const { slug, wasCreated } = await writeVaultNote({
        title,
        body,
        type: typ,
        tags: args["tags"] as string[] | undefined,
      });

      if (process.env["AGENT_MEMORY_AUTOLINK"] === "1" && !body.includes("[[")) {
        const all = await listAllNotes({ limit: 80 });
        const candidateTitles = all.map((n) => n.title).filter((t) => t !== title);
        const extra = await suggestWikilinkLine({
          title,
          body,
          candidateTitles,
        });
        if (extra) {
          body = body + extra;
          await writeVaultNote({ title, body, type: typ, tags: args["tags"] as string[] | undefined });
        }
      }

      const action = wasCreated ? "Created" : "Updated";
      const vault = getVaultDir();
      return {
        ok: true,
        output: `${action} vault note: "${title}" (${typ})\nSlug: ${slug}\nVault: ${vault}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ─── vault_read ───────────────────────────────────────────────────────────────

export const vaultReadTool = defineTool({
  name: "vault_read",
  description:
    "WHAT: Read a vault note by title and see its wikilinks and backlinks.\n" +
    "WHEN: To retrieve rich knowledge, follow a [[Wikilink]], or inspect connections.\n" +
    "Use vault_search() first if you're not sure of the exact title.\n" +
    "ARGS: title — note title or slug to look up.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Note title or slug",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const title = args["title"] as string;
    const note = await findNote(title);
    if (!note) {
      return {
        ok: false,
        error: `Note not found: "${title}". Use vault_search() or vault_list() to find available notes.`,
      };
    }

    const backlinks = await getBacklinks(note.title);
    const forwardLinks = extractWikilinks(note.body);

    const header = [
      `# ${note.title}`,
      `Type: ${note.type}  |  Tags: ${note.tags.length > 0 ? note.tags.map((t) => `#${t}`).join(" ") : "(none)"}`,
      `Updated: ${note.updated.slice(0, 10)}  |  Created: ${note.created.slice(0, 10)}`,
      forwardLinks.length > 0
        ? `Links to: ${forwardLinks.map((l) => `[[${l}]]`).join("  ·  ")}`
        : "",
      backlinks.length > 0
        ? `Linked from: ${backlinks.map((b) => `[[${b.title}]]`).join("  ·  ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return { ok: true, output: `${header}\n\n---\n\n${note.body}` };
  },
});

// ─── vault_search ─────────────────────────────────────────────────────────────

export const vaultSearchTool = defineTool({
  name: "vault_search",
  description:
    "WHAT: Full-text search across all vault notes.\n" +
    "WHEN: Finding knowledge by content when you don't know the exact title.\n" +
    "Always vault_search() before vault_write() to avoid duplicate notes.\n" +
    "ARGS: query — search term; type — optional type filter; tag — optional tag filter.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (substring match across title, tags, body)" },
      type: {
        type: "string",
        enum: ["fact", "entity", "reflection", "recipe", "task", "note", "episode"],
        description: "Optional: filter by note type",
      },
      tag: { type: "string", description: "Optional: filter by tag" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const query = args["query"] as string;
    const results = await searchVault(query, {
      type: args["type"] as NoteType | undefined,
      tag:  args["tag"]  as string | undefined,
    });

    if (results.length === 0) {
      return { ok: true, output: `No vault notes found matching "${query}".` };
    }

    const lines = results.slice(0, 10).map(({ note, snippet }) => {
      const tags = note.tags.length > 0 ? `  #${note.tags.join(" #")}` : "";
      return `[[${note.title}]] (${note.type}${tags})\n  ${snippet}`;
    });

    const more = results.length > 10 ? `\n…and ${results.length - 10} more` : "";
    return {
      ok: true,
      output: `Found ${results.length} notes matching "${query}":\n\n${lines.join("\n\n")}${more}`,
    };
  },
});

// ─── vault_list ───────────────────────────────────────────────────────────────

export const vaultListTool = defineTool({
  name: "vault_list",
  description:
    "WHAT: Browse vault notes with optional filtering, sorted by most recently updated.\n" +
    "WHEN: Checking what you already know, or discovering notes before writing.\n" +
    "ARGS: type — optional type filter; tag — optional tag filter; limit — max results (default 20).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["fact", "entity", "reflection", "recipe", "task", "note", "episode"],
        description: "Filter by note type",
      },
      tag: { type: "string", description: "Filter by tag" },
      limit: { type: "number", minimum: 1, maximum: 100, description: "Max results (default 20)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const notes = await listAllNotes({
      type:  args["type"]  as NoteType | undefined,
      tag:   args["tag"]   as string | undefined,
      limit: (args["limit"] as number | undefined) ?? 20,
    });

    if (notes.length === 0) {
      return { ok: true, output: "(vault is empty — use vault_write() to create your first note)" };
    }

    const lines = notes.map((n) => {
      const tags = n.tags.length > 0 ? `  #${n.tags.join(" #")}` : "";
      const preview = n.body.replace(/^#+\s+/gm, "").replace(/\n/g, " ").trim().slice(0, 80);
      return `[[${n.title}]] — ${n.type}${tags}  (${n.updated.slice(0, 10)})\n  ${preview}${n.body.length > 80 ? "…" : ""}`;
    });

    return {
      ok: true,
      output: `${notes.length} notes (sorted by most recently updated):\n\n${lines.join("\n\n")}`,
    };
  },
});

// ─── vault_links ──────────────────────────────────────────────────────────────

export const vaultLinksTool = defineTool({
  name: "vault_links",
  description:
    "WHAT: Show all forward wikilinks and backlinks for a note.\n" +
    "WHEN: To explore the knowledge graph around a concept, or audit a note's connections.\n" +
    "ARGS: title — the note to inspect.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title to inspect" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const title = args["title"] as string;
    const note = await findNote(title);
    if (!note) {
      return { ok: false, error: `Note not found: "${title}"` };
    }

    const forwardLinks = extractWikilinks(note.body);
    const backlinks    = await getBacklinks(note.title);

    const lines = [
      `Links FROM [[${note.title}]] (${forwardLinks.length}):`,
      forwardLinks.length > 0
        ? forwardLinks.map((l) => `  → [[${l}]]`).join("\n")
        : "  (none — add [[Wikilinks]] in the body to connect concepts)",
      "",
      `Links TO [[${note.title}]] (${backlinks.length}):`,
      backlinks.length > 0
        ? backlinks.map((b) => `  ← [[${b.title}]] (${b.type})`).join("\n")
        : "  (none — no other notes link to this one yet)",
    ];

    return { ok: true, output: lines.join("\n") };
  },
});

// ─── vault_graph ─────────────────────────────────────────────────────────────

export const vaultGraphTool = defineTool({
  name: "vault_graph",
  description:
    "WHAT: Traverse the knowledge graph from a starting note, following wikilinks and backlinks.\n" +
    "WHEN: To explore a conceptual neighbourhood, discover related knowledge, or understand how\n" +
    "concepts connect. Great before writing a new note to see what already exists nearby.\n" +
    "ARGS: title — starting note; depth — traversal depth 1–3 (default 2).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Starting note title" },
      depth: {
        type: "number",
        minimum: 1,
        maximum: 3,
        description: "Graph traversal depth (default 2)",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const title    = args["title"] as string;
    const maxDepth = Math.min((args["depth"] as number | undefined) ?? 2, 3);

    const graph = await traverseGraph(title, maxDepth);
    if (graph.size === 0) {
      return {
        ok: false,
        error: `Starting note not found: "${title}". Use vault_list() to see available notes.`,
      };
    }

    const lines: string[] = [
      `Knowledge graph from [[${title}]] (depth ${maxDepth}, ${graph.size} nodes):\n`,
    ];

    // Sort by depth then title for readable output
    const entries = [...graph.values()].sort(
      (a, b) => a.depth - b.depth || a.note.title.localeCompare(b.note.title)
    );

    for (const { note, depth, forwardLinks, backlinks } of entries) {
      const indent  = "  ".repeat(depth);
      const tags    = note.tags.length > 0 ? ` [#${note.tags.join(" #")}]` : "";
      const fwd     = forwardLinks.length > 0 ? `  → ${forwardLinks.slice(0, 3).map((l) => `[[${l}]]`).join(" ")}` : "";
      const bkl     = backlinks.length > 0    ? `  ← ${backlinks.slice(0, 3).map((b) => `[[${b}]]`).join(" ")}` : "";
      lines.push(`${indent}[[${note.title}]] (${note.type}${tags})${fwd}${bkl}`);
    }

    return { ok: true, output: lines.join("\n") };
  },
});

// ─── vault_delete ─────────────────────────────────────────────────────────────

export const vaultDeleteTool = defineTool({
  name: "vault_delete",
  description:
    "WHAT: Permanently delete a vault note.\n" +
    "WHEN: The knowledge is wrong, stale, or superseded by a better note.\n" +
    "Use vault_search() first to confirm you have the right title.\n" +
    "ARGS: title — note title or slug to delete.",
  requiresApproval: false,
  dangerLevel: "cautious" as const,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title or slug to delete" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const title = args["title"] as string;
    const deleted = await deleteVaultNote(title);
    if (!deleted) {
      return {
        ok: false,
        error: `Note not found: "${title}". Use vault_list() to see available notes.`,
      };
    }
    return { ok: true, output: `Deleted vault note: "${title}"` };
  },
});
