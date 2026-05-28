/**
 * Live harness smoke: monolithic HTML 3D airplane game (write_file stress + coherence).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import type { Scenario } from "../runner.js";
import {
  traceCollectTextBlob,
  traceHasTool,
  traceHasTurnEnd,
  traceToolRanOk,
} from "../runner.js";

const GAME_PATH = ".agent_artifacts/eval-airplane-3d.html";

function gameFileAbs(): string {
  return join(resolveWorkspaceRoot(), GAME_PATH);
}

function readGameFile(): string | null {
  const abs = gameFileAbs();
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export const monolithicHtmlAirplaneGame: Scenario = {
  name: "monolithic-html-airplane-game",
  userMessage:
    "Build a monolithic single-file HTML5 3D airplane flight game (one .html file, no external model assets). " +
    "Use Three.js from a CDN and create the airplane mesh programmatically (fuselage, wings, tail — not a placeholder cube only). " +
    "Include: sky + ground/terrain, basic flight physics, keyboard controls (WASD or arrows), HUD showing speed and altitude, " +
    "and simple crash/reset behavior. " +
    `Save to \`${GAME_PATH}\`. ` +
    "If the file is large, use write_file mode=create for the first chunk then mode=append for the rest — do not lose work on retries. " +
    "When the file is saved and you have verified it exists on disk, reply exactly: PLAYABLE_OK",
  maxRounds: 30,
  timeoutMs: 600_000,
  tags: ["files", "slow"],
  assertions: [
    { name: "turn_end fires", check: (t) => traceHasTurnEnd(t) },
    {
      name: "write_file ran at least once",
      check: (t) => traceHasTool(t, "write_file"),
    },
    {
      name: "write_file succeeded",
      check: (t) => traceToolRanOk(t, "write_file"),
    },
    {
      name: "game file exists with substantive HTML",
      check: () => {
        const body = readGameFile();
        if (!body) return false;
        return body.length >= 6_000 && /<html[\s>]/i.test(body) && /<script/i.test(body);
      },
    },
    {
      name: "uses WebGL/Three stack",
      check: () => {
        const body = readGameFile();
        if (!body) return false;
        return /three\.min\.js|three\.module\.js|THREE\.|type\s*=\s*["']module["']/i.test(body);
      },
    },
    {
      name: "programmatic geometry hints",
      check: () => {
        const body = readGameFile();
        if (!body) return false;
        return /BufferGeometry|BoxGeometry|ConeGeometry|CylinderGeometry|ShapeGeometry/i.test(body);
      },
    },
    {
      name: "model claims playable",
      check: (t) => traceCollectTextBlob(t).includes("PLAYABLE_OK"),
    },
  ],
};

export const MONOLITHIC_HTML_GAME_SCENARIOS = [monolithicHtmlAirplaneGame];
