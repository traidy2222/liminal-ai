/**
 * Validates multi-part file creation (write_file create + append) without a single giant tool arg.
 */
import type { Scenario } from "../runner.js";
import { traceHasOrderedTools, traceToolRanOk } from "../runner.js";

export const largeFileWriteTwoPart: Scenario = {
  name: "large-file-write-two-part",
  userMessage:
    "Create `.agent_artifacts/eval-two-part.txt` with exactly two lines using tools only: " +
    "1) write_file with mode `create` and content `PART_A\\n`. " +
    "2) write_file with mode `append` and content `PART_B\\n`. " +
    "Reply OK when both tool calls succeeded.",
  maxRounds: 12,
  timeoutMs: 90_000,
  tags: ["files"],
  assertions: [
    {
      name: "write_file create then append in order",
      check: (t) => traceHasOrderedTools(t, "write_file", "write_file"),
    },
    {
      name: "write_file ran ok",
      check: (t) => traceToolRanOk(t, "write_file"),
    },
  ],
};

export const LARGE_FILE_WRITE_SCENARIOS = [largeFileWriteTwoPart];
