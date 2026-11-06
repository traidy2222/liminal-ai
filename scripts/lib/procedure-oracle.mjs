import { isDeepStrictEqual } from "node:util";
/** External frozen task oracle. JSON object member order has no significance. */
export function matchesRequestedRecord(actual, input) {
  return isDeepStrictEqual(actual, {
    name: input.name,
    symbol: input.symbol,
    kind: "provider",
  });
}
