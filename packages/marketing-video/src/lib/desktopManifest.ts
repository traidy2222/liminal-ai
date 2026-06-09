import { staticFile } from "remotion";

export type DesktopCaptureResult = {
  id: string;
  title?: string;
  subtitle?: string;
  accent?: string;
  prompt?: string;
  png?: string;
  gif?: string;
  mp4?: string;
  messagesPath?: string;
  tools?: string[];
  durationMs?: number;
  messageCount?: number;
  chatId?: string;
  source?: string;
  error?: string;
};

export type DesktopManifest = {
  generatedAt?: string;
  source?: string;
  windowTitle?: string;
  results: DesktopCaptureResult[];
};

/**
 * Preview fallbacks when desktop capture has not been run yet.
 * Uses prior **live** harness recordings (real session logs, not fixtures).
 */
export const DESKTOP_PREVIEW_FALLBACK: DesktopManifest = {
  source: "preview-fallback",
  results: [
    {
      id: "desktop-code-ship-test",
      title: "Plan, ship, and verify code",
      subtitle:
        "plan → write_file → run_shell (node:test) — self-healing loop with every step visible in the harness.",
      png: "marketing/live-coding-debounce.png",
      gif: "marketing/live-coding-debounce.gif",
      messagesPath: "marketing/recordings/live-coding-debounce/messages.json",
      accent: "#00ff88",
      tools: ["plan", "write_file", "run_shell"],
    },
    {
      id: "desktop-repo-react-trace",
      title: "Map the repo, trace the ReAct loop",
      subtitle:
        "repo_map, grep_file, read_file_chunked — orient in a monorepo and explain how tool results close the loop.",
      png: "marketing/live-repo-grep.png",
      gif: "marketing/live-repo-grep.gif",
      messagesPath: "marketing/recordings/live-repo-grep/messages.json",
      accent: "#00d4ff",
      tools: ["grep_file", "read_file", "repo_map"],
    },
    {
      id: "desktop-memory-recall",
      title: "Memory that survives the session",
      subtitle:
        "remember, recall_relevant, memory_stats — typed notes with hybrid retrieval.",
      png: "marketing/live-git-status.png",
      gif: "marketing/live-git-status.gif",
      messagesPath: "marketing/recordings/live-git-status/messages.json",
      accent: "#ff4488",
      tools: ["remember", "recall_relevant", "memory_stats"],
    },
    {
      id: "desktop-web-research-cite",
      title: "Research with receipts",
      subtitle:
        "web_search + web_fetch — cite primary docs with URLs and concrete API field names.",
      png: "marketing/live-web-research.png",
      gif: "marketing/live-web-research.gif",
      messagesPath: "marketing/recordings/live-web-research/messages.json",
      accent: "#cc88ff",
      tools: ["web_search", "web_fetch"],
    },
  ],
};

export const DESKTOP_MANIFEST_URL = staticFile("marketing/desktop-manifest.json");

export async function loadDesktopManifest(): Promise<DesktopManifest> {
  try {
    const res = await fetch(DESKTOP_MANIFEST_URL);
    if (!res.ok) return DESKTOP_PREVIEW_FALLBACK;
    const json = (await res.json()) as DesktopManifest;
    if (!json.results?.length) return DESKTOP_PREVIEW_FALLBACK;
    const ok = json.results.filter((r) => !r.error && r.png);
    if (!ok.length) return DESKTOP_PREVIEW_FALLBACK;
    return { ...json, results: ok };
  } catch {
    return DESKTOP_PREVIEW_FALLBACK;
  }
}

export type ParsedMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; name: string; status?: string; argsJson?: string }
  | { kind: "tool_result"; ok?: boolean; output?: string };

export type MessagesRecording = {
  prompt?: string;
  messages: ParsedMessage[];
  meta?: { tools?: string[]; durationMs?: number };
};

export async function loadMessagesRecording(
  messagesPath: string | undefined
): Promise<MessagesRecording | null> {
  if (!messagesPath) return null;
  try {
    const res = await fetch(staticFile(messagesPath));
    if (!res.ok) return null;
    return (await res.json()) as MessagesRecording;
  } catch {
    return null;
  }
}
