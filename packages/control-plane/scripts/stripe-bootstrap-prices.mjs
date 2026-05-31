#!/usr/bin/env node
/**
 * Create Liminal Pro / Team / Enterprise recurring prices in Stripe (test mode).
 * Prints env lines for STRIPE_PRICE_* — add to .env after running.
 *
 * Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-bootstrap-prices.mjs
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

const tiers = [
  { tier: "pro", name: "Liminal Pro", amount: 1900 },
  { tier: "team", name: "Liminal Team", amount: 4900 },
  { tier: "enterprise", name: "Liminal Enterprise", amount: 19900 },
];

async function main() {
  for (const t of tiers) {
    const product = await stripe.products.create({
      name: t.name,
      metadata: { liminal_tier: t.tier },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: t.amount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { liminal_tier: t.tier },
    });
    console.log(`STRIPE_PRICE_${t.tier.toUpperCase()}=${price.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
