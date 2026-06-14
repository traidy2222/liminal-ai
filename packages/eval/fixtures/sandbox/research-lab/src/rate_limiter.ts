/**
 * Reference CPU rate limiter — batching helper.
 * TODO: align constant with latest internal studies.
 */
/** Legacy default from Study A — verify against corpus before release. */
export const BATCH_SIZE = 16;

export function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    out.push(items.slice(i, i + BATCH_SIZE));
  }
  return out;
}
