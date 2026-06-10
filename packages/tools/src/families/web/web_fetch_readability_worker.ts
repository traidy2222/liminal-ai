/**
 * Isolated JSDOM + Readability parse so a pathological page cannot block the main
 * event loop (which would stall AGENT_WEB_FETCH_TOTAL_WALL_MS timers and the UI).
 */
import { parentPort, workerData } from "node:worker_threads";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface WebFetchReadabilityWorkerData {
  html: string;
  pageUrl: string;
}

try {
  const { html, pageUrl } = workerData as WebFetchReadabilityWorkerData;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {
    /* ignore CSS parse noise */
  });
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  const text = article?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  parentPort?.postMessage({ ok: true as const, text });
} catch (err) {
  parentPort?.postMessage({ ok: false as const, error: String(err) });
}
