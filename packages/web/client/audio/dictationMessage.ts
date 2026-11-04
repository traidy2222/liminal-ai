/** Final ASR replaces the whole provisional span; preview text is never authoritative. */
export function dictationMessage(input: string, start: number, spanLength: number, finalText: string): string {
  const before = input.slice(0, start);
  const after = input.slice(start + spanLength);
  return (before + (before && !/\s$/.test(before) ? " " : "") + finalText.trim() + after).trim();
}
