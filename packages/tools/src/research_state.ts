/**
 * research_state — surface the harness's per-send research ledger to the model.
 *
 * The model can ask the harness directly: "what have I searched, what URLs are
 * surfaced but not fetched, what fetches succeeded or failed". Removes the
 * blindness that drives scattershot retrieval. Multidomain — operates on
 * behavior records, not topics.
 *
 * Closes over a ResearchLedger instance; created per harness via the
 * onChildCreated hook so child agents get their own (not the parent's).
 */
import type { ResearchLedger } from "@liminal/core";
import { defineTool } from "./helpers.js";

export function createResearchStateTool(ledger: ResearchLedger) {
  return defineTool({
    name: "research_state",
    description:
      "WHAT: Return the harness's research ledger for this send — every web_search query, every URL surfaced, every fetch outcome.\n" +
      "WHEN: Before deciding whether to run another web_search; when planning which URL to web_fetch next; before writing a final answer to know what evidence you have.\n" +
      "NOT WHEN: You haven't done any web work this send (returns empty).\n" +
      "ARGS: view — \"summary\" (default, compact one-screen view) | \"pending\" (URLs surfaced but not fetched) | \"fetched\" (successful fetches with word counts) | \"failures\" (fetch failures) | \"queries\" (full query list with surfaced-URL counts) | \"all\" (everything, longest). " +
      "limit — max items per section (default 20).",
    requiresApproval: false,
    dangerLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["summary", "pending", "fetched", "failures", "queries", "all"],
          description: "Which slice of the ledger to return.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Max items per section. Default 20.",
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const view = (args["view"] as string | undefined) ?? "summary";
      const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 20;

      if (ledger.isEmpty()) {
        return {
          ok: true,
          output:
            "research_state: ledger is empty this send. No web_search or web_fetch calls yet.\n" +
            "Tip: call web_search to start gathering, then web_fetch to commit to specific URLs.",
        };
      }

      const lines: string[] = [];
      const s = ledger.summary();
      lines.push(
        `research ledger this send — searches=${s.searchCount} uniq_intent=${s.uniqueQueryCount} ` +
          `urls=${s.urlInventoryCount} fetched_ok=${s.fetchedOk} fetched_fail=${s.fetchedFail} pending=${s.pending}`
      );

      const includePending = view === "pending" || view === "summary" || view === "all";
      const includeFetched = view === "fetched" || view === "summary" || view === "all";
      const includeFailures = view === "failures" || view === "summary" || view === "all";
      const includeQueries = view === "queries" || view === "all";

      if (includeQueries) {
        lines.push("");
        lines.push(`queries (${ledger.getQueries().length} total, showing ${Math.min(limit, ledger.getQueries().length)}):`);
        for (const q of ledger.getQueries().slice(-limit)) {
          const status = q.ok ? `${q.surfaced.length} urls` : "FAILED";
          lines.push(`  • "${q.query}" (${status})`);
        }
      }

      if (includePending) {
        const pending = ledger.getPendingUrls();
        lines.push("");
        lines.push(`pending fetches (${pending.length} total, showing ${Math.min(limit, pending.length)}):`);
        if (pending.length === 0) {
          lines.push("  (none — every surfaced URL has been attempted)");
        } else {
          for (const u of pending.slice(0, limit)) {
            const t = u.title ? `${u.title} — ` : "";
            lines.push(`  • ${t}${u.url}`);
          }
        }
      }

      if (includeFetched) {
        const fetched = ledger.getUrls({ status: "fetched_ok" });
        lines.push("");
        lines.push(`successful fetches (${fetched.length} total, showing latest ${Math.min(limit, fetched.length)}):`);
        if (fetched.length === 0) {
          lines.push("  (none yet — commit to a URL with web_fetch)");
        } else {
          for (const u of fetched.slice(-limit)) {
            const wc = u.fetchedWordCount != null ? ` (${u.fetchedWordCount}w)` : "";
            lines.push(`  • ${u.url}${wc}`);
          }
        }
      }

      if (includeFailures) {
        const failures = ledger.getUrls({ status: "fetched_fail" });
        if (failures.length > 0) {
          lines.push("");
          lines.push(`fetch failures (${failures.length} total, showing latest ${Math.min(limit, failures.length)}):`);
          for (const u of failures.slice(-limit)) {
            lines.push(`  • ${u.url}${u.fetchError ? ` — ${u.fetchError}` : ""}`);
          }
        }
      }

      if (view === "summary") {
        lines.push("");
        lines.push(
          "next moves: web_fetch a pending URL · web_search with a new intent bucket · " +
            "query_tool_outputs to retrieve a prior result body · hypothesize() to commit to a direction · " +
            "write the answer if coverage is sufficient."
        );
      }

      return { ok: true, output: lines.join("\n") };
    },
  });
}
