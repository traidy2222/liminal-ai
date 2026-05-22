import { withProviderRequestSpacing, effectiveHarnessEnvRaw } from "@liminal/core";

function personaGenTimeoutMs(): number {
  return Math.max(
    20_000,
    Math.min(180_000, parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_GEN_TIMEOUT_MS") ?? "90000", 10) || 90_000)
  );
}

function personaGenMaxAttempts(): number {
  return Math.max(1, Math.min(3, parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_GEN_RETRIES") ?? "2", 10) || 2));
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || /aborted/i.test(err.message);
}

function parseSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return null;
  try {
    const j = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const piece = j.choices?.[0]?.delta?.content;
    return typeof piece === "string" && piece.length > 0 ? piece : null;
  } catch {
    return null;
  }
}

/** Stream chat completion content deltas (OpenAI-compatible SSE). */
export async function* callPersonaModelStream(
  apiKey: string,
  model: string,
  baseURL: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number
): AsyncGenerator<string, void, undefined> {
  const timeoutMs = personaGenTimeoutMs();
  const maxAttempts = personaGenMaxAttempts();
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await withProviderRequestSpacing(
        { apiKey, baseURL },
        () =>
          fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/liminal-ai",
              "X-Title": "Liminal",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              max_tokens: maxTokens,
              temperature,
              stream: true,
            }),
            signal: controller.signal,
          })
      );
      if (!response.ok) throw new Error(`LLM API returned HTTP ${response.status}`);
      const body = response.body;
      if (!body) throw new Error("LLM stream body missing");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let carry = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += decoder.decode(value, { stream: true });
          const lines = carry.split("\n");
          carry = lines.pop() ?? "";
          for (const line of lines) {
            const delta = parseSseDelta(line);
            if (delta) yield delta;
          }
        }
        if (carry.trim()) {
          const delta = parseSseDelta(carry);
          if (delta) yield delta;
        }
      } finally {
        reader.releaseLock();
      }
      return;
    } catch (err) {
      lastErr = err;
      if (!isAbortError(err) || attempt >= maxAttempts) throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Persona stream failed");
}

const STREAM_EMIT_MS = 100;

/** Accumulate stream into buffer; invoke onDelta throttled. Returns full buffer. */
export async function streamPersonaModelToBuffer(
  apiKey: string,
  model: string,
  baseURL: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  onDelta: (buffer: string) => void
): Promise<string> {
  let buf = "";
  let lastEmit = 0;
  for await (const piece of callPersonaModelStream(
    apiKey,
    model,
    baseURL,
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature
  )) {
    buf += piece;
    const now = Date.now();
    if (now - lastEmit >= STREAM_EMIT_MS) {
      try { onDelta(buf); } catch { /* non-fatal — stream continues */ }
      lastEmit = now;
    }
  }
  try { onDelta(buf); } catch { /* non-fatal */ }
  return buf;
}
