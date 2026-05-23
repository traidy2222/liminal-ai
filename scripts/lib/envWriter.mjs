import fs from "node:fs";

export const API_KEY_VARS = [
  "AGENT_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
];

/**
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {Record<string, string>} env
 * @returns {string | null}
 */
export function firstApiKey(env) {
  for (const key of API_KEY_VARS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

/**
 * Merge keys into an existing .env (or seed from example). Preserves unrelated keys and comments.
 *
 * @param {{ envPath: string; examplePath?: string; updates: Record<string, string> }} opts
 */
export function writeEnvMerge({ envPath, examplePath, updates }) {
  let base = "";
  if (fs.existsSync(envPath)) {
    base = fs.readFileSync(envPath, "utf8");
  } else if (examplePath && fs.existsSync(examplePath)) {
    base = fs.readFileSync(examplePath, "utf8");
  }

  /** @type {Record<string, string>} */
  const merged = base ? parseEnvFile(base) : {};
  for (const [key, value] of Object.entries(updates)) {
    merged[key] = value;
  }

  const lines = base ? base.split(/\r?\n/) : [];
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      out.push(`${key}=${formatEnvValue(updates[key])}`);
      seen.add(key);
    } else {
      out.push(line);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      out.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  fs.writeFileSync(envPath, `${out.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

/** @param {string} value */
function formatEnvValue(value) {
  if (/[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * @param {Record<string, string>} env
 * @returns {number}
 */
export function resolvePort(env) {
  const raw = env.PORT?.trim() || process.env.PORT?.trim() || "3001";
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : 3001;
}
