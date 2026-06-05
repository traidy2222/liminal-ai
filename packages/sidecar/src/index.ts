#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadHarnessEnvFiles,
  loadRuntimePreferences,
  resolveProviderConfigWithInference,
  resolveWorkspaceRoot,
} from "@liminal/core";
import { WsServer } from "./ws_server.js";
import { clearHandshake, handshakePath, mintToken, writeHandshake } from "./handshake.js";

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

const workspaceRoot = resolveWorkspaceRoot();

async function main(): Promise<void> {
  const runtimePreferences = await loadRuntimePreferences(workspaceRoot);
  const provider = await resolveProviderConfigWithInference(
    runtimePreferences?.provider,
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
    void clearHandshake().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // Die with the parent: if stdin closes (parent exited), shut down.
  process.stdin.on("close", () => shutdown("stdin_close"));
  process.stdin.resume();
}

main().catch((err) => {
  process.stderr.write(`liminald: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
