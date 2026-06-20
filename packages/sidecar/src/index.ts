#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  ensureLocalProviderApiKeyInProcess,
  ensureProviderApiKeysInProcess,
  loadHarnessEnvFiles,
  loadRuntimePreferences,
  resolveProviderConfigWithInference,
  resolveWorkspaceRoot,
  refreshStaleXeroAccounts,
} from "@liminal/core";
import { WsServer } from "./ws_server.js";
import { clearHandshake, handshakePath, mintToken, writeHandshake } from "./handshake.js";
import {
  initCrashReporter,
  captureException,
  close as closeCrashReporter,
  readDsnFromFile,
} from "./crash_reporter.js";

/**
 * `liminald` — the Liminal harness sidecar.
 *
 * Launched as a child process by the native desktop app. Resolves the provider,
 * binds a token-gated WebSocket server on 127.0.0.1:<ephemeral>, and writes the
 * port + token to `~/.liminal/sidecar.json` for the UI to discover.
 */

// Load secrets before OAuth decrypt / provider resolution (desktop bundle often has no .env until copied).
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Monorepo / desktop bundle root — set by the Flutter app when not using a standard packages/sidecar/dist layout. */
const repoRoot =
  process.env["LIMINAL_REPO_ROOT"]?.trim() || join(__dirname, "../../../");
loadHarnessEnvFiles({ repoRoot, cwd: process.cwd() });
process.env["LIMINAL_SIDECAR"] = "1";

// Initialize crash reporter before main work starts.
(async () => {
  const sentryDsnPath = join(homedir(), ".liminal", "sentry.dsn");
  const dsn = await readDsnFromFile(sentryDsnPath);
  if (dsn) {
    initCrashReporter({
      dsn,
      environment: process.env["NODE_ENV"] === "development" ? "development" : "production",
      release: "0.1.0",
    });
  }
})().catch(() => {
  // Crash reporter init failure is non-fatal.
});
/** Desktop turns feel slow with sidecar LLM passes — enable unless user set this in .env. */
if (!process.env["AGENT_LATENCY_MODE"]?.trim()) {
  process.env["AGENT_LATENCY_MODE"] = "1";
}
ensureProviderApiKeysInProcess();
ensureLocalProviderApiKeyInProcess();
void refreshStaleXeroAccounts().catch(() => {
  /* non-fatal — refresh on integrations load / first tool call */
});

const workspaceRoot = resolveWorkspaceRoot();

async function main(): Promise<void> {
  const runtimePreferences = await loadRuntimePreferences(workspaceRoot);
  const provider = await resolveProviderConfigWithInference(
    runtimePreferences?.provider?.model
      ? { model: runtimePreferences.provider.model }
      : undefined,
    runtimePreferences
  );

  const token = mintToken();
  const server = new WsServer({ token, provider, runtimePreferences, repoRoot });
  const port = await server.listen();
  const record = await writeHandshake({ port, token, pid: process.pid });

  // Machine-readable boot line for the parent (the Flutter app reads stdout
  // first, then falls back to polling the handshake file).
  process.stdout.write(
    `LIMINALD_READY ${JSON.stringify({ port, handshake: handshakePath(), protocolVersion: record.protocolVersion })}\n`
  );

  const shutdown = (signal: string): void => {
    process.stdout.write(`liminald: shutting down (${signal})\n`);
    server.close();
    void clearHandshake()
      .then(() => closeCrashReporter())
      .finally(() => process.exit(0));
  };
  // Die with the parent when stdin is an active pipe. Ignored/inherited stdin
  // (Flutter `Process.start` default) must not trigger immediate shutdown.
  if (process.stdin.readable && !process.stdin.isTTY) {
    process.stdin.on("close", () => shutdown("stdin_close"));
    process.stdin.resume();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    const message =
      reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    process.stderr.write(`liminald: unhandledRejection: ${message}\n`);
    captureException(reason, { context: "sidecar_unhandled_rejection" });
  });

  process.on("uncaughtException", (err) => {
    process.stderr.write(`liminald: uncaughtException: ${err.stack ?? err.message}\n`);
    captureException(err, { context: "sidecar_uncaught_exception" });
    void closeCrashReporter().finally(() => process.exit(1));
  });
}

main().catch((err) => {
  const message = `liminald: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
  process.stderr.write(`${message}\n`);
  captureException(err, { context: "sidecar_fatal" });
  void closeCrashReporter().finally(() => process.exit(1));
});
