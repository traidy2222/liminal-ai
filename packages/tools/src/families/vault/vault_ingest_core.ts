/**
 * Shared vault ingest / graph-weave logic (ingest, entities, auto-write, curator).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  writeVaultNote,
  findNote,
  searchVault,
  findNearDuplicateNote,
  getVaultDir,
  type NoteType,
  type VaultNote,
} from "./vault_store.js";
import { upsertVaultEmbeddings } from "./vault_index.js";
import { resolveEmbedCreds, semanticVaultHits, type EmbedCreds } from "./vault_embed.js";
import {
  selectCrossLinks,
  injectRelatedLinkRefs,
  injectSourcesLinks,
  appendLogLine,
  upsertIndexEntry,
  selectInboundWeaveTitles,
  prependCallout,
  buildContradictionCallout,
  buildMocBody,
  mocTitleForTopic,
  type NeighborCandidate,
} from "./vault_nexus.js";
import {
  resolveWikilinkRefs,
  relinkMarkdownTitles,
  noteRelLinkPath,
  type WikilinkRef,
} from "./vault_wikilink.js";
import { canAutoEditNote, ensureAgentTags, resolveVaultAgentPrefix } from "./vault_agent_zone.js";

export { type NeighborCandidate };

/** Merge semantic (cosine) + lexical (BM25 rank) neighbors. */
export async function gatherVaultNeighbors(
  title: string,
  content: string,
  creds: EmbedCreds | null
): Promise<{ candidates: NeighborCandidate[]; mode: "hybrid" | "bm25" }> {
  const byTitle = new Map<string, NeighborCandidate>();
  const add = (c: NeighborCandidate) => {
    const key = c.title.trim().toLowerCase();
    if (!key) return;
    const prev = byTitle.get(key);
    if (!prev || c.score > prev.score) byTitle.set(key, c);
  };

  let mode: "hybrid" | "bm25" = "bm25";
  const hits = await semanticVaultHits(`${title}\n\n${content}`, 12, creds);
  if (hits.length > 0) {
    mode = "hybrid";
    for (const hit of hits) add({ title: hit.title, slug: hit.slug, score: hit.score });
  }

  try {
    const results = await searchVault(`${title} ${content.slice(0, 240)}`);
    results.slice(0, 12).forEach((r, i) => {
      add({ title: r.note.title, slug: r.note.slug, score: Math.max(0.18, 0.6 - i * 0.04) });
    });
  } catch {
    /* empty vault */
  }

  return { candidates: [...byTitle.values()], mode };
}

export function resolveSpinePath(fileName: string): string {
  const prefix = resolveVaultAgentPrefix().replace(/^\/+|\/+$/g, "");
  if (prefix) {
    const agentPath = join(getVaultDir(), prefix, fileName);
    if (fileName === "index.md" || fileName === "log.md") {
      const legacy = join(getVaultDir(), fileName);
      if (!existsSync(agentPath) && existsSync(legacy)) return legacy;
    }
    return agentPath;
  }
  return join(getVaultDir(), fileName);
}

export async function updateSpineFile(
  fileName: string,
  transform: (existing: string) => string
): Promise<void> {
  const fp = resolveSpinePath(fileName);
  await mkdir(join(fp, ".."), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(fp, "utf8");
  } catch {
    /* new */
  }
  await writeFile(fp, transform(existing), "utf8");
}

export interface WeaveNoteParams {
  title: string;
  content: string;
  type: NoteType;
  tags?: string[];
  summary?: string;
  maxOutbound?: number;
  maxInbound?: number;
  checkContradiction?: boolean;
  sourceLinkTitles?: string[];
  creds?: EmbedCreds | null;
}

export interface WeaveNoteResult {
  slug: string;
  existed: boolean;
  linkTitles: string[];
  inboundUpdated: string[];
  mode: "hybrid" | "bm25";
  body: string;
}

/** Write a note woven into the graph with bidirectional links + spine + embeddings. */
export async function weaveNoteIntoGraph(params: WeaveNoteParams): Promise<WeaveNoteResult> {
  const title = params.title.trim();
  const tags = ensureAgentTags(params.tags);
  const creds = params.creds ?? (await resolveEmbedCreds());
  const existed = !!(await findNote(title));

  const { candidates, mode } = await gatherVaultNeighbors(title, params.content, creds);
  const linkTitles = selectCrossLinks(title, candidates, {
    max: params.maxOutbound ?? 8,
    minScore: 0.15,
  });
  const linkRefs = await resolveWikilinkRefs(linkTitles);

  let body = await relinkMarkdownTitles(params.content);
  body = injectRelatedLinkRefs(body, linkRefs);
  if (params.sourceLinkTitles?.length) {
    const sourceRefs: WikilinkRef[] = params.sourceLinkTitles.map((t) => ({
      target: t.replace(/\.md$/i, ""),
      label: t.split("/").pop(),
    }));
    body = injectSourcesLinks(body, sourceRefs);
  }

  if (params.checkContradiction !== false) {
    const dupes = await findNearDuplicateNote(title, body, { limit: 1, threshold: 0.72 });
    const best = dupes[0];
    if (best && best.note.title.toLowerCase() !== title.toLowerCase()) {
      body = prependCallout(
        body,
        buildContradictionCallout({
          conflictingLink: { target: noteRelLinkPath(best.note), label: best.note.title },
          detail: `Near-duplicate score ${best.score.toFixed(2)} — verify which claim is current.`,
        })
      );
    }
  }

  const { slug, filePath } = await writeVaultNote({ title, body, type: params.type, tags });
  const selfRef: WikilinkRef = { target: noteRelLinkPath({ filePath }), label: title };

  const inboundTitles = selectInboundWeaveTitles(linkTitles, params.maxInbound ?? 3);
  const inboundUpdated: string[] = [];
  const embedNotes: Array<{ slug: string; title: string; type: string; body: string }> = [
    { slug, title, type: params.type, body },
  ];

  for (const neighborTitle of inboundTitles) {
    const neighbor = await findNote(neighborTitle);
    if (!neighbor || !canAutoEditNote(neighbor)) continue;
    if (neighbor.title.toLowerCase() === title.toLowerCase()) continue;
    const newBody = injectRelatedLinkRefs(neighbor.body, [selfRef]);
    if (newBody === neighbor.body) continue;
    await writeVaultNote({
      title: neighbor.title,
      body: newBody,
      type: neighbor.type,
      tags: neighbor.tags,
    });
    inboundUpdated.push(neighbor.title);
    embedNotes.push({
      slug: neighbor.slug,
      title: neighbor.title,
      type: neighbor.type,
      body: newBody,
    });
  }

  if (creds) {
    try {
      await upsertVaultEmbeddings({
        apiKey: creds.apiKey,
        baseURL: creds.baseURL,
        model: creds.model,
        notes: embedNotes,
      });
    } catch {
      /* non-fatal */
    }
  }

  const summary =
    params.summary?.trim() ||
    body.replace(/^#+\s+/gm, "").replace(/\[\[|\]\]/g, "").replace(/\n+/g, " ").trim().slice(0, 160);
  const date = new Date().toISOString().slice(0, 10);
  try {
    await updateSpineFile("index.md", (cur) =>
      upsertIndexEntry(cur, {
        title,
        type: params.type,
        summary,
        linkTarget: selfRef.target,
      })
    );
    await updateSpineFile("log.md", (cur) =>
      appendLogLine(cur, { date, action: existed ? "update" : "ingest", title })
    );
  } catch {
    /* spine optional */
  }

  return { slug, existed, linkTitles, inboundUpdated, mode, body };
}

/** Upsert a MOC hub note for a topic cluster. */
export async function upsertMocForTopic(
  topic: string,
  memberTitles: string[],
  creds?: EmbedCreds | null
): Promise<string | null> {
  const t = topic.trim();
  if (!t || memberTitles.length < 2) return null;
  const mocTitle = mocTitleForTopic(t);
  const memberRefs = await resolveWikilinkRefs(memberTitles);
  const body = buildMocBody(t, memberRefs);
  await weaveNoteIntoGraph({
    title: mocTitle,
    content: body,
    type: "moc",
    tags: ["moc", "hub"],
    summary: `Map of content: ${t}`,
    maxOutbound: 12,
    maxInbound: 2,
    creds: creds ?? null,
  });
  return mocTitle;
}
