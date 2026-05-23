/**
 * Workflow evals: multi-file apply, git checkpoint/rollback, dispatch_graph DAG, research chain.
 */
import type { Scenario } from "../runner.js";
import {
  traceHasOrderedTools,
  traceHasTurnEnd,
  traceToolRanOk,
  traceToolResults,
} from "../runner.js";

export const WORKFLOW_EVAL_SCENARIOS: Scenario[] = [
  {
    name: "multi-file-apply-smoke",
    userMessage:
      "Create two tiny files in the workspace: `eval_multi_a.txt` with content 'alpha' and " +
      "`eval_multi_b.txt` with content 'beta' using multi_file_apply (dry_run=false). " +
      "Then read_file each path once to confirm. Reply in one sentence with both filenames.",
    maxRounds: 20,
    timeoutMs: 120_000,
    assertions: [
      { name: "multi_file_apply ok", check: (t) => traceToolRanOk(t, "multi_file_apply") },
      { name: "read_file ok", check: (t) => traceToolRanOk(t, "read_file") },
      { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    ],
  },
  {
    name: "git-checkpoint-rollback-smoke",
    env: { AGENT_TOOL_LAZY: "1" },
    userMessage:
      "Activate git family if needed. Run git_checkpoint with message 'eval checkpoint'. " +
      "Write eval_git_probe.txt with write_file content 'before'. " +
      "Overwrite eval_git_probe.txt with content 'after'. " +
      "Call git_rollback to restore. read_file eval_git_probe.txt and report whether content is 'before'.",
    maxRounds: 28,
    timeoutMs: 120_000,
    assertions: [
      { name: "git_checkpoint ok", check: (t) => traceToolRanOk(t, "git_checkpoint") },
      { name: "git_rollback ok", check: (t) => traceToolRanOk(t, "git_rollback") },
      { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    ],
  },
  {
    name: "dispatch-graph-dependent-write",
    userMessage:
      "Use dispatch_graph to run read_file on package.json and grep_file for \"name\" in parallel, " +
      "then write_file eval_dag_out.txt summarizing the package name from those reads. " +
      "One sentence answer mentioning the package name.",
    maxRounds: 24,
    timeoutMs: 120_000,
    assertions: [
      { name: "dispatch_graph ok", check: (t) => traceToolRanOk(t, "dispatch_graph") },
      { name: "write after graph", check: (t) => traceHasOrderedTools(t, "dispatch_graph", "write_file") },
      { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    ],
  },
  {
    name: "web-search-fetch-research-chain",
    userMessage:
      "Research 'TypeScript satisfies operator' briefly: web_search once, then web_fetch at least two distinct URLs from results, " +
      "then answer in 2-3 sentences with at least one citation URL.",
    maxRounds: 24,
    timeoutMs: 120_000,
    assertions: [
      { name: "web_search ok", check: (t) => traceToolRanOk(t, "web_search") },
      {
        name: "web_fetch chain",
        check: (trace) =>
          traceToolResults(trace, "web_fetch").filter((r) => r.result.ok).length >= 2,
      },
      { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    ],
  },
];
