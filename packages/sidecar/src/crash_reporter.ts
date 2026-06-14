import * as Sentry from "@sentry/node";

export interface CrashReporterConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  userOptIn?: boolean;
}

let initialized = false;

export function initCrashReporter(config: CrashReporterConfig): void {
  if (initialized) return;
  if (!config.dsn) return;

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment ?? process.env["NODE_ENV"] ?? "production",
    release: config.release ?? "0.1.0",
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.1,
    sendDefaultPii: false,
  });

  initialized = true;
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized) return;

  Sentry.captureException(error, (scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setTag(key, String(value));
      }
    }
    return scope;
  });
}

export function captureMessage(
  message: string,
  level?: "info" | "warning" | "error" | "fatal"
): void {
  if (!initialized) return;

  const sentryLevel = level
    ? {
        info: "info" as const,
        warning: "warning" as const,
        error: "error" as const,
        fatal: "fatal" as const,
      }[level] ?? "info"
    : "info";

  Sentry.captureMessage(message, sentryLevel);
}

export function setUserContext(
  userId?: string,
  email?: string,
  username?: string
): void {
  if (!initialized) return;

  Sentry.setUser({
    id: userId,
    email: email,
    username: username,
  });
}

export function clearUserContext(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

export function addBreadcrumb(
  message: string,
  category?: string,
  level?: "debug" | "info" | "warning" | "error"
): void {
  if (!initialized) return;

  Sentry.addBreadcrumb({
    message,
    category: category ?? "app",
    level: level ?? "info",
  });
}

export async function close(): Promise<void> {
  if (!initialized) return;
  await Sentry.close();
}

export async function readDsnFromFile(path: string): Promise<string> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path, "utf-8");
    return content.trim();
  } catch {
    return "";
  }
}
