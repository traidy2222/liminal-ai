import { createHash } from "node:crypto";
export interface BrowserFindingInput { statement: string; quote: string; kind?: "observation" | "inference" }
export interface BrowserFinding extends BrowserFindingInput {
  id: string; url: string; title: string; observed_at: string;
  support: "matched_page_text" | "search_lead";
}
const normalized = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Provenance ledger, not an entailment judge. Quotes must exist on the observed page. */
export class BrowserFindings {
  private entries: BrowserFinding[] = [];
  record(source: {url: string; title: string; text: string}, input: BrowserFindingInput[]): BrowserFinding[] {
    const page = normalized(source.text);
    for (const item of input) {
      if (!item.statement?.trim() || item.statement.length > 600 || !item.quote?.trim() || item.quote.length > 1000 || normalized(item.quote).length < 5)
        throw Error("Each finding needs a statement (1–600 chars) and a supporting page quote (5–1000 chars).");
      if (item.kind && item.kind !== 'observation' && item.kind !== 'inference') throw Error('Finding kind must be observation or inference.');
      if (!page.includes(normalized(item.quote))) throw Error("Supporting quote was not found in the current rendered page. Read the relevant passage; no findings from this batch were recorded.");
    }
    const url = new URL(source.url);
    const lead = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(url.hostname) && (url.searchParams.has("q") || url.pathname.includes("/search"));
    const recorded = input.map(item => {
      const previous = this.entries.find(row => row.url === source.url && row.statement === item.statement && normalized(row.quote) === normalized(item.quote));
      const id='B-'+createHash('sha256').update(source.url+'\n'+item.statement+'\n'+normalized(item.quote)).digest('hex').slice(0,10);
      const row: BrowserFinding = { id: previous?.id ?? id, statement: item.statement.trim(), quote: item.quote.trim(), kind: item.kind ?? "observation",
        url: source.url, title: source.title, observed_at: new Date().toISOString(), support: lead ? "search_lead" : "matched_page_text" };
      if (previous) this.entries = this.entries.filter(entry => entry.id !== previous.id);
      this.entries.push(row); return row;
    });
    this.entries = this.entries.slice(-80); return recorded;
  }
  list(): BrowserFinding[] { return this.entries.map(row => ({...row})); }
}

const ledgers = new Map<string, BrowserFindings>();
export function findingsForTask(taskId: string): BrowserFindings {
  let ledger = ledgers.get(taskId);
  if (!ledger) { ledger = new BrowserFindings(); ledgers.set(taskId, ledger); }
  if (ledgers.size > 128) ledgers.delete(ledgers.keys().next().value!);
  return ledger;
}
