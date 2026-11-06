/** Playwright timeouts do not bound every CDP evaluation or frame lookup. */
export async function browserDeadline<T>(action: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
