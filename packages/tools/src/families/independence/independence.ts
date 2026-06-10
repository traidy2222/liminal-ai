/**
 * Independence engine — breaks behavioral lock-in during free runs.
 *
 * Tracks what domains/tools the agent uses session-over-session.
 * On free-run activation, derives "forbidden zones" from recent patterns,
 * picks a random divergence seed, and writes `.agent_independence.json`.
 * The world context gatherer reads this file and injects the BREAKOUT MANDATE.
 *
 * Tools:
 *   breakout_start   — activate free-run mode (forbidden zones + seed domain)
 *   pattern_record   — record what this session covered (call at turn end)
 *   independence_status — read current state + recent patterns
 */

import type { ToolDefinition } from "@liminal/core";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveWorkspaceRoot } from "@liminal/core";

const INDEPENDENCE_FILE = ".agent_independence.json";

// ─── Seed domain library ──────────────────────────────────────────────────────

export const SEED_DOMAINS: Array<{ domain: string; spark: string }> = [
  { domain: "mycology and fungal intelligence", spark: "How do fungal networks make decisions without brains? Model one." },
  { domain: "18th-century Ottoman cartography", spark: "What did the world look like from Istanbul in 1750? Build a mental map." },
  { domain: "mathematical knot theory", spark: "Explore trefoil knots, their invariants, and why they can't be untied." },
  { domain: "deep-sea bioluminescence", spark: "Why does the dark ocean glow? Map the species and mechanisms." },
  { domain: "Mongolian throat singing physics", spark: "How does one larynx produce two simultaneous pitches? Model the acoustics." },
  { domain: "cryptographic zero-knowledge proofs", spark: "Prove you know a secret without revealing it. Build an example." },
  { domain: "the linguistics of whistled languages", spark: "Map the world's whistled languages and what they tell us about speech." },
  { domain: "permafrost methane dynamics", spark: "How much frozen carbon is there and when does it tip?" },
  { domain: "the evolution of writing systems", spark: "Trace one writing system from pictograph to alphabet." },
  { domain: "Byzantine iconography rule systems", spark: "What are the exact rules governing icon composition?" },
  { domain: "extremophile biology", spark: "What lives in boiling acid and what can it teach about life's origin?" },
  { domain: "Sufi poetry and mystical mathematics", spark: "What is the geometry of Rumi's metaphysics?" },
  { domain: "the history of color pigments", spark: "Trace how a specific color (e.g. blue, purple) changed history." },
  { domain: "Arctic indigenous knowledge systems", spark: "What do Inuit navigation traditions know that GPS doesn't?" },
  { domain: "generative music theory", spark: "Build a small algorithmic composition rule set from first principles." },
  { domain: "the global history of fermentation", spark: "Why does every civilization independently discover fermentation?" },
  { domain: "psychoacoustics and musical illusions", spark: "Build the Shepard tone mentally. What other audio illusions exist?" },
  { domain: "the physics of sand dunes", spark: "Why do dunes form? Can they sing? Model their dynamics." },
  { domain: "dark matter detection methods", spark: "What have we actually tried and why hasn't it worked?" },
  { domain: "the anthropology of gift economies", spark: "Model a society where accumulation is shameful." },
  { domain: "Andean textile mathematics", spark: "Quipu cords encoded census data. Reconstruct the encoding." },
  { domain: "coral reef acoustic ecology", spark: "Healthy reefs are loud. Map the soundscape and what its silence means." },
  { domain: "Viking Age navigation techniques", spark: "How did Norse sailors navigate without compasses? Rebuild the toolkit." },
  { domain: "the thermodynamics of cooking", spark: "Why does browning happen? Model the Maillard reaction." },
  { domain: "Mesoamerican astronomical knowledge", spark: "The Maya predicted Venus to ±2 seconds. How, with no telescopes?" },
  { domain: "the semiotics of emoji evolution", spark: "Track how 🙏 changed meaning over 10 years. What does that tell us?" },
  { domain: "complexity theory and emergence", spark: "Write the simplest rule set that generates something you didn't expect." },
  { domain: "computational creativity research", spark: "What would it take for a computer to have genuine aesthetic taste?" },
  { domain: "medieval Islamic algebra", spark: "Al-Khwarizmi invented algebra. Reconstruct his original problems." },
  { domain: "neuroplasticity and learning science", spark: "What actually changes in the brain when you learn a skill?" },
  { domain: "colonial-era spice trade economics", spark: "Why was nutmeg worth more than gold in 1600? Trace the supply chain." },
  { domain: "exoplanet atmospheric chemistry", spark: "What biosignatures would prove life exists on a distant world?" },
  { domain: "the sociology of anonymous online communities", spark: "What social norms emerge when identity is removed?" },
  { domain: "quantum error correction", spark: "How do you protect a qubit from decoherence? Build an intuition." },
  { domain: "Amazonian ethnobotany", spark: "The Amazon is a pharmacy. Map 10 plants and what they teach." },
  { domain: "Brutalist architecture philosophy", spark: "What did Brutalism mean to believe? Defend it." },
  { domain: "the anthropology of board games", spark: "Trace how Go, Chess, and Mancala reflect the civilizations that made them." },
  { domain: "Amazonian dark earth (terra preta)", spark: "Pre-Columbian civilizations made soil. How, and what does it mean?" },
  { domain: "the philosophy of time in different cultures", spark: "Which cultures have cyclical time? What does that change?" },
  { domain: "the evolution of human laughter", spark: "Laughter is pre-linguistic. What is it actually for?" },
  { domain: "surrealist logic and dream grammar", spark: "Build a grammar for dream-logic. Write one scene in it." },
  { domain: "cellular automata and emergent complexity", spark: "What is the simplest rule that produces unpredictability?" },
  { domain: "the physics of music strings", spark: "Why do harmonics occur? Build the mathematics from a vibrating string." },
  { domain: "Tibetan sand mandala traditions", spark: "Monks build mandalas for weeks then destroy them. What is the point?" },
  { domain: "the mathematics of origami", spark: "Paper folding is a branch of geometry. Map its theorems." },
  { domain: "historical epidemics and social change", spark: "Pick one plague and trace how it rewired a civilization." },
  { domain: "the science of smell and memory", spark: "Why is smell the strongest memory trigger? Map the neuroscience." },
  { domain: "game theory and cooperation", spark: "When does defection become rational? Build a scenario where it doesn't." },
];

// ─── Data file ────────────────────────────────────────────────────────────────

export interface SessionRecord {
  date: string;
  topics: string[];
  tool_patterns: string[];
  vault_tags: string[];
}

export interface IndependenceState {
  sessions: SessionRecord[];
  active_breakout: {
    domain: string;
    spark: string;
    forbidden_topics: string[];
    activated_at: string;
  } | null;
}

function independencePath(): string {
  return path.join(resolveWorkspaceRoot(), INDEPENDENCE_FILE);
}

async function readState(): Promise<IndependenceState> {
  try {
    const raw = await fs.readFile(independencePath(), "utf-8");
    return JSON.parse(raw) as IndependenceState;
  } catch {
    return { sessions: [], active_breakout: null };
  }
}

async function writeState(state: IndependenceState): Promise<void> {
  await fs.writeFile(independencePath(), JSON.stringify(state, null, 2), "utf-8");
}

/** Pick a seed domain that hasn't been used in recent sessions. */
function pickSeedDomain(state: IndependenceState, explicitDomain?: string): { domain: string; spark: string } {
  if (explicitDomain) {
    const found = SEED_DOMAINS.find((d) => d.domain.toLowerCase().includes(explicitDomain.toLowerCase()));
    if (found) return found;
  }
  // Use date + session count as deterministic-but-rotating seed
  const dateStr = new Date().toISOString().slice(0, 10);
  const hash = [...dateStr].reduce((acc, c) => acc + c.charCodeAt(0), 0) + state.sessions.length;
  return SEED_DOMAINS[hash % SEED_DOMAINS.length]!;
}

/** Derive forbidden topics from the last 5 session records. */
function deriveForbiddenTopics(sessions: SessionRecord[]): string[] {
  const recent = sessions.slice(-5);
  const topicCounts = new Map<string, number>();
  for (const s of recent) {
    for (const t of [...s.topics, ...s.vault_tags]) {
      const key = t.toLowerCase().trim();
      if (key) topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
    }
  }
  // Topics appearing in 2+ of the last 5 sessions are "forbidden"
  return [...topicCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([topic]) => topic)
    .slice(0, 12);
}

// ─── breakout_start ───────────────────────────────────────────────────────────

export const breakoutStartTool: ToolDefinition = {
  name: "breakout_start",
  requiresApproval: false,
  description:
    "Activate free-run independence mode. Derives forbidden topic zones from recent session history, " +
    "picks a random divergence seed domain, and writes the mandate to disk. " +
    "The world context will then show a BREAKOUT MANDATE at the top of every turn. " +
    "Call this at the START of a free-run session before doing anything else.",
  parameters: {
    type: "object",
    properties: {
      seed_domain: {
        type: "string",
        description: "Optional: override the random seed domain with a specific topic.",
      },
      extra_forbidden: {
        type: "array",
        items: { type: "string" },
        description: "Optional: additional topics to explicitly forbid this session.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args) => {
    const state = await readState();
    const seed = pickSeedDomain(state, args["seed_domain"] as string | undefined);
    const forbidden = deriveForbiddenTopics(state.sessions);
    const extra = (args["extra_forbidden"] as string[] | undefined) ?? [];
    const allForbidden = [...new Set([...forbidden, ...extra.map((s) => s.toLowerCase())])];

    state.active_breakout = {
      domain: seed.domain,
      spark: seed.spark,
      forbidden_topics: allForbidden,
      activated_at: new Date().toISOString(),
    };
    await writeState(state);

    const forbidLine = allForbidden.length > 0
      ? `\nForbidden zones (recent patterns): ${allForbidden.join(", ")}`
      : "\nNo forbidden zones detected (no session history yet).";

    return {
      ok: true,
      output:
        `BREAKOUT ACTIVE.\n\n` +
        `Seed domain: ${seed.domain}\n` +
        `Spark: ${seed.spark}` +
        forbidLine +
        `\n\nThe world context now shows the BREAKOUT MANDATE. Do NOT touch geopolitics, economy, or any forbidden zone. ` +
        `Start from the seed domain. Go weird. Call pattern_record at the end of the session.`,
    };
  },
};

// ─── pattern_record ───────────────────────────────────────────────────────────

export const patternRecordTool: ToolDefinition = {
  name: "pattern_record",
  requiresApproval: false,
  description:
    "Record what topics, tools, and vault tags were used this session. " +
    "Call this at the END of any significant session (free run or regular). " +
    "Builds the history that drives future forbidden-zone detection.",
  parameters: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: { type: "string" },
        description: "Key topics covered this session (e.g. ['iran', 'ceasefire', 'rba']).",
      },
      tool_patterns: {
        type: "array",
        items: { type: "string" },
        description: "Tool names used heavily this session.",
      },
      vault_tags: {
        type: "array",
        items: { type: "string" },
        description: "Vault note tags written this session.",
      },
    },
    required: ["topics"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const state = await readState();
    const record: SessionRecord = {
      date: new Date().toISOString().slice(0, 10),
      topics: (args["topics"] as string[]).map((t) => t.toLowerCase().trim()),
      tool_patterns: ((args["tool_patterns"] as string[] | undefined) ?? []).map((t) => t.toLowerCase()),
      vault_tags: ((args["vault_tags"] as string[] | undefined) ?? []).map((t) => t.toLowerCase()),
    };
    state.sessions.push(record);
    // Keep last 10 sessions
    if (state.sessions.length > 10) state.sessions = state.sessions.slice(-10);
    // Clear active breakout when recording
    state.active_breakout = null;
    await writeState(state);
    return { ok: true, output: `Session recorded. ${state.sessions.length} sessions in history.` };
  },
};

// ─── independence_status ──────────────────────────────────────────────────────

export const independenceStatusTool: ToolDefinition = {
  name: "independence_status",
  requiresApproval: false,
  description:
    "Read current independence state: active breakout mandate, recent patterns, and derived forbidden zones. " +
    "Use this to understand what your own behavioral ruts look like.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  handler: async () => {
    const state = await readState();
    const forbidden = deriveForbiddenTopics(state.sessions);

    const lines: string[] = [];

    if (state.active_breakout) {
      lines.push(`BREAKOUT ACTIVE`);
      lines.push(`Seed: ${state.active_breakout.domain}`);
      lines.push(`Spark: ${state.active_breakout.spark}`);
      lines.push(`Forbidden: ${state.active_breakout.forbidden_topics.join(", ")}`);
      lines.push(`Activated: ${state.active_breakout.activated_at}`);
    } else {
      lines.push(`No active breakout. Call breakout_start to activate.`);
    }

    lines.push(`\nPattern history (${state.sessions.length} sessions):`);
    for (const s of state.sessions.slice(-5)) {
      lines.push(`  ${s.date}: topics=[${s.topics.join(", ")}] tools=[${s.tool_patterns.join(", ")}]`);
    }

    if (forbidden.length > 0) {
      lines.push(`\nDerived forbidden zones (2+ sessions): ${forbidden.join(", ")}`);
    }

    const seed = pickSeedDomain(state);
    lines.push(`\nNext available seed domain: ${seed.domain}`);
    lines.push(`Spark: ${seed.spark}`);

    return { ok: true, output: lines.join("\n") };
  },
};

// ─── World-context gatherer (exported for world_context.ts) ───────────────────

export async function gatherBreakoutMandate(workspaceRoot: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, INDEPENDENCE_FILE), "utf-8");
    const state = JSON.parse(raw) as IndependenceState;
    if (!state.active_breakout) return null;

    const b = state.active_breakout;
    const lines: string[] = [
      `[BREAKOUT MANDATE — FREE RUN MODE ACTIVE]`,
      `Seed domain: ${b.domain}`,
      `Spark: ${b.spark}`,
    ];
    if (b.forbidden_topics.length > 0) {
      lines.push(`FORBIDDEN (repeat patterns): ${b.forbidden_topics.join(", ")}`);
    }
    lines.push(`MANDATE: Do NOT consult memory for familiar topics. Do NOT write geopolitical briefings.`);
    lines.push(`Start from the seed domain. Go deep into something genuinely unfamiliar.`);
    lines.push(`Weird output > reliable output. Exploration > competence this session.`);
    lines.push(`→ Call pattern_record at session end.`);
    return lines;
  } catch {
    return null;
  }
}
