/** Authenticated sidecar broker to the app-owned native WebView2 tabs. */
import { randomUUID } from "node:crypto";

export type DesktopBrowserCommand = { id: string; action: "open" | "close"; tabId: string };
type Pending = { command: DesktopBrowserCommand; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
let desktop: { clientId: string; endpoint: string; seen: number } | undefined;
const pending = new Map<string, Pending>();
let waiter: ((command: DesktopBrowserCommand | null) => void) | undefined;
const delivered = new Set<string>();

export function desktopBrowserEndpoint(): string | undefined {
  return desktop && Date.now() - desktop.seen < 45_000 ? desktop.endpoint : undefined;
}

export function registerDesktopBrowser(clientId: string, port: number): void {
  if (!clientId || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid desktop browser registration");
  if (desktopBrowserEndpoint() && desktop?.clientId !== clientId) throw new Error("Another Liminal window owns the browser profile");
  desktop = { clientId, endpoint: `http://127.0.0.1:${port}`, seen: Date.now() };
}

export async function pollDesktopBrowser(clientId: string): Promise<DesktopBrowserCommand | null> {
  if (!desktop || desktop.clientId !== clientId) throw new Error("Desktop browser is not registered");
  desktop.seen = Date.now();
  const next = [...pending.values()].find(p => !delivered.has(p.command.id));
  if (next) { delivered.add(next.command.id); return next.command; }
  // Only one poll per owner. Resolve an abandoned previous poll before replacing it.
  waiter?.(null);
  return new Promise(resolve => {
    const done = (command: DesktopBrowserCommand | null) => {
      clearTimeout(timer);
      if (waiter === done) waiter = undefined;
      if (command) delivered.add(command.id);
      resolve(command);
    };
    const timer = setTimeout(() => done(null), 20_000);
    waiter = done;
  });
}

export function completeDesktopBrowserCommand(clientId: string, id: string, error?: string): void {
  if (desktop?.clientId !== clientId) throw new Error("Desktop browser owner mismatch");
  desktop.seen = Date.now();
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id); delivered.delete(id); clearTimeout(entry.timer);
  if (error) entry.reject(new Error(error)); else entry.resolve();
}

export function requestDesktopBrowserTab(action: "open" | "close", tabId: string): Promise<void> {
  if (!desktopBrowserEndpoint()) return Promise.reject(new Error("Desktop browser is disconnected"));
  return new Promise((resolve, reject) => {
    const command = { id: randomUUID(), action, tabId };
    const timer = setTimeout(() => {
      pending.delete(command.id); delivered.delete(command.id);
      reject(new Error("Desktop browser did not respond. Keep Liminal open and retry."));
    }, 30_000);
    pending.set(command.id, { command, resolve, reject, timer });
    waiter?.(command);
  });
}

export function disconnectDesktopBrowser(): void {
  desktop = undefined; waiter?.(null);
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Browser manager stopped")); }
  pending.clear(); delivered.clear();
}
