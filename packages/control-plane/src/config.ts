import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIREON_LICENSE_PUBLIC_KEY_PEM,
  type LicenseTier,
} from "@liminal/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load .env from monorepo root, then package dir (package wins). */
export function loadEnv(): void {
  const root = path.resolve(__dirname, "../../..");
  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, "packages/control-plane/.env") });
}

export type PaidTier = Exclude<LicenseTier, "community">;

export interface ControlPlaneConfig {
  port: number;
  licensePrivateKeyPem: string;
  licensePublicKeyPem: string;
  licenseTermDays: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePricePro: string;
  stripePriceTeam: string;
  stripePriceEnterprise: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
}

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() ?? fallback;
}

export function loadConfig(): ControlPlaneConfig {
  const licenseTermDays = Number(opt("CONTROL_PLANE_LICENSE_TERM_DAYS", "30"));
  return {
    port: Number(opt("CONTROL_PLANE_PORT", opt("PORT", "3002"))),
    licensePrivateKeyPem: req("CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM"),
    licensePublicKeyPem: opt("CONTROL_PLANE_LICENSE_PUBLIC_KEY_PEM", VIREON_LICENSE_PUBLIC_KEY_PEM),
    licenseTermDays: Number.isFinite(licenseTermDays) && licenseTermDays > 0 ? licenseTermDays : 30,
    supabaseUrl: req("SUPABASE_URL"),
    supabaseServiceRoleKey: req("SUPABASE_SERVICE_ROLE_KEY"),
    supabaseAnonKey: opt("SUPABASE_ANON_KEY"),
    stripeSecretKey: req("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: req("STRIPE_WEBHOOK_SECRET"),
    stripePricePro: opt("STRIPE_PRICE_PRO"),
    stripePriceTeam: opt("STRIPE_PRICE_TEAM"),
    stripePriceEnterprise: opt("STRIPE_PRICE_ENTERPRISE"),
    checkoutSuccessUrl: opt(
      "STRIPE_CHECKOUT_SUCCESS_URL",
      "http://localhost:3000/dashboard?session_id={CHECKOUT_SESSION_ID}"
    ),
    checkoutCancelUrl: opt("STRIPE_CHECKOUT_CANCEL_URL", "http://localhost:3000/pricing"),
  };
}

/** Map Stripe price id → license tier. */
export function tierForStripePriceId(config: ControlPlaneConfig, priceId: string): PaidTier | null {
  if (!priceId) return null;
  if (config.stripePricePro && priceId === config.stripePricePro) return "pro";
  if (config.stripePriceTeam && priceId === config.stripePriceTeam) return "team";
  if (config.stripePriceEnterprise && priceId === config.stripePriceEnterprise) return "enterprise";
  return null;
}

export function stripePriceIdForTier(config: ControlPlaneConfig, tier: PaidTier): string {
  const map: Record<PaidTier, string> = {
    pro: config.stripePricePro,
    team: config.stripePriceTeam,
    enterprise: config.stripePriceEnterprise,
  };
  const id = map[tier]?.trim();
  if (!id) throw new Error(`STRIPE_PRICE_${tier.toUpperCase()} is not configured`);
  return id;
}
