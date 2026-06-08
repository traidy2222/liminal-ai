export type StripeMode = "read_write" | "read_only";

export const STRIPE_DEFAULT_MODE: StripeMode = "read_write";

/** Stripe Connect OAuth scope (Standard / extension accounts). */
export function stripeScopeForMode(mode: StripeMode): "read_write" | "read_only" {
  return mode === "read_only" ? "read_only" : "read_write";
}
