import React from "react";

export type IntegrationBrandId =
  | "google"
  | "microsoft"
  | "xero"
  | "slack"
  | "linear"
  | "stripe"
  | "github"
  | "advanced";

export type IntegrationBrandMeta = {
  id: IntegrationBrandId;
  title: string;
  tagline: string;
  accent: string;
  accentSoft: string;
};

export const INTEGRATION_BRANDS: Record<IntegrationBrandId, IntegrationBrandMeta> = {
  google: {
    id: "google",
    title: "Google",
    tagline: "Gmail, Calendar, Drive & Docs",
    accent: "#4285F4",
    accentSoft: "rgba(66, 133, 244, 0.14)",
  },
  microsoft: {
    id: "microsoft",
    title: "Microsoft 365",
    tagline: "Outlook, Teams & OneDrive",
    accent: "#00A4EF",
    accentSoft: "rgba(0, 164, 239, 0.14)",
  },
  xero: {
    id: "xero",
    title: "Xero",
    tagline: "Invoices & accounting",
    accent: "#13B5EA",
    accentSoft: "rgba(19, 181, 234, 0.14)",
  },
  slack: {
    id: "slack",
    title: "Slack",
    tagline: "Channels, messages & team chat",
    accent: "#E01E5A",
    accentSoft: "rgba(224, 30, 90, 0.12)",
  },
  linear: {
    id: "linear",
    title: "Linear",
    tagline: "Issues, teams & project tracking",
    accent: "#5E6AD2",
    accentSoft: "rgba(94, 106, 210, 0.14)",
  },
  stripe: {
    id: "stripe",
    title: "Stripe",
    tagline: "Payments, subscriptions & billing",
    accent: "#635BFF",
    accentSoft: "rgba(99, 91, 255, 0.14)",
  },
  github: {
    id: "github",
    title: "GitHub",
    tagline: "Repos, issues & pull requests",
    accent: "#E6EDF3",
    accentSoft: "rgba(230, 237, 243, 0.1)",
  },
  advanced: {
    id: "advanced",
    title: "Advanced",
    tagline: "Custom APIs & servers",
    accent: "#9AA8B8",
    accentSoft: "rgba(154, 168, 184, 0.12)",
  },
};

function LogoSvg({ id }: { id: IntegrationBrandId }) {
  switch (id) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.28-.97 2.36-2.06 3.08l3.32 2.58C20.88 18.4 22 16.04 22 13c0-3.31-2.69-6-6-6-1.66 0-3.16.67-4.24 1.76L12 10.2z" />
          <path fill="#34A853" d="M6 14.09 3.57 16.5A9.96 9.96 0 0 0 12 22c2.7 0 4.97-.89 6.63-2.42l-3.32-2.58c-.92.62-2.1.99-3.31.99-2.54 0-4.7-1.72-5.47-4.03z" />
          <path fill="#FBBC05" d="M2 12c0-.69.12-1.35.34-1.97L6 14.09V9.91A5.99 5.99 0 0 0 2 12z" />
          <path fill="#4285F4" d="M12 6c1.47 0 2.79.51 3.83 1.51l2.87-2.87C16.15 2.99 14.2 2 12 2 7.7 2 4.01 4.47 2.34 8.09l3.66 2.84C6.7 8.72 9.16 6 12 6z" />
        </svg>
      );
    case "microsoft":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <rect x="2" y="2" width="9.2" height="9.2" fill="#F25022" />
          <rect x="12.8" y="2" width="9.2" height="9.2" fill="#7FBA00" />
          <rect x="2" y="12.8" width="9.2" height="9.2" fill="#00A4EF" />
          <rect x="12.8" y="12.8" width="9.2" height="9.2" fill="#FFB900" />
        </svg>
      );
    case "xero":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <circle cx="12" cy="12" r="11" fill="#13B5EA" />
          <path
            fill="#fff"
            d="M7.2 15.6 10.4 12 7.2 8.4h2.1l2.1 2.6 2.1-2.6h2.1L12.8 12l3.2 3.6h-2.1l-2.1-2.6-2.1 2.6z"
          />
        </svg>
      );
    case "slack":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <path fill="#E01E5A" d="M5.042 14.668a1.75 1.75 0 0 1-1.75-1.75V9.917a1.75 1.75 0 1 1 3.5 0v3.001a1.75 1.75 0 0 1-1.75 1.75Z" />
          <path fill="#36C5F0" d="M9.917 18.958a1.75 1.75 0 0 1-1.75-1.75v-3.5a1.75 1.75 0 1 1 3.5 0v3.5a1.75 1.75 0 0 1-1.75 1.75Z" />
          <path fill="#2EB67D" d="M14.668 18.958a1.75 1.75 0 0 1-1.75-1.75v-3.001a1.75 1.75 0 1 1 3.5 0v3.001a1.75 1.75 0 0 1-1.75 1.75Z" />
          <path fill="#ECB22E" d="M18.958 14.668a1.75 1.75 0 0 1-1.75-1.75V9.917a1.75 1.75 0 1 1 3.5 0v3.001a1.75 1.75 0 0 1-1.75 1.75Z" />
        </svg>
      );
    case "linear":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden fill="#5E6AD2">
          <path d="M3.5 17.2 17.2 3.5l3.3 3.3L6.8 20.5 3.5 17.2Zm4.9-4.9 6.6-6.6 1.7 1.7-6.6 6.6-1.7-1.7Z" />
        </svg>
      );
    case "stripe":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden fill="#635BFF">
          <path d="M13.3 10.2c0-.9-.7-1.2-1.9-1.4-1.5-.2-1.7-.6-1.7-1 0-.6.5-1 1.5-1 1.1 0 1.7.4 1.8 1.1h1.8c-.1-1.5-1.2-2.6-3.6-2.6-2.1 0-3.5 1.1-3.5 2.7 0 1.7 1.3 2.2 3.2 2.5 1.6.2 1.9.6 1.9 1.1 0 .7-.6 1.1-1.7 1.1-1.4 0-2-.5-2.1-1.3H7.4c.1 1.7 1.4 2.8 4.1 2.8 2.3 0 3.8-1.1 3.8-2.8Z" />
          <path d="M4.5 6.5h13v11H4.5v-11Z" fill="none" stroke="#635BFF" strokeWidth="1.4" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden fill="#E6EDF3">
          <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.36-3.37-1.36-.45-1.17-1.11-1.48-1.11-1.48-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.9 1.56 2.36 1.11 2.94.85.09-.67.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.32.1-2.74 0 0 .84-.27 2.75 1.05A9.2 9.2 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.42.2 2.48.1 2.74.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
        </svg>
      );
    case "advanced":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden fill="none" stroke="#9AA8B8" strokeWidth="1.6">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2.1 2.1 0 1 1-2.97 2.97l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .33 1.7 1.7 0 0 0-.67 1.37V21a2.1 2.1 0 1 1-4.2 0v-.09A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.87-.34l-.06.06a2.1 2.1 0 1 1-2.97-2.97l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.33-1 1.7 1.7 0 0 0-1.37-.67H2.1a2.1 2.1 0 1 1 0-4.2h.09A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2.1 2.1 0 1 1 2.97-2.97l.06.06A1.7 1.7 0 0 0 8 4.6a1.7 1.7 0 0 0 1-.33 1.7 1.7 0 0 0 .67-1.37V2.1a2.1 2.1 0 1 1 4.2 0v.09A1.7 1.7 0 0 0 16 4.6a1.7 1.7 0 0 0 1.87.34l.06-.06a2.1 2.1 0 1 1 2.97 2.97l-.06.06A1.7 1.7 0 0 0 19.4 8c.12.35.2.72.23 1.1.03.38.01.76-.06 1.13-.07.37-.2.72-.39 1.04-.19.32-.43.6-.71.84-.28.24-.6.43-.95.56Z" />
        </svg>
      );
  }
}

export function IntegrationBrandLogo({
  id,
  size = 48,
}: {
  id: IntegrationBrandId;
  size?: number;
}) {
  const brand = INTEGRATION_BRANDS[id];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: brand.accentSoft,
        border: `1px solid ${brand.accent}33`,
        flexShrink: 0,
      }}
    >
      <LogoSvg id={id} />
    </div>
  );
}
