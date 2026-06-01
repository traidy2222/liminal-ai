import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { loadEnv, loadConfig } from "./config.js";
import { createSupabaseAdmin } from "./supabase_admin.js";
import { createRoutes, createStripeWebhookHandler, type RouteDeps } from "./routes.js";

loadEnv();

function main() {
  const config = loadConfig();
  const db = createSupabaseAdmin(config);
  const stripe = new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" });
  const deps: RouteDeps = { config, db, stripe };

  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    })
  );

  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    createStripeWebhookHandler(deps)
  );

  app.use(express.json({ limit: "64kb" }));
  app.use(createRoutes(deps));

  app.listen(config.port, () => {
    console.log(`[control-plane] listening on :${config.port}`);
  });
}

main();
