import { useCallback, useEffect, useRef, useState } from "react";

import { webApiFetch } from "./webApiAuth.js";
import type { InferenceWalletSnapshot } from "./useSSE.js";

const WEB_SERVER_BASE = "";

type InferenceStatus = {
  configured?: boolean;
  entitled?: boolean;
  reason?: string;
  remainingUsd?: number | null;
  capUsd?: number | null;
  usedUsd?: number | null;
  periodEnd?: string | null;
};

type Props = {
  vireonConnected: boolean;
  managedRoute: boolean;
  /** Real-time wallet snapshot from SSE (preferred over poll when present). */
  liveWallet?: InferenceWalletSnapshot | null;
  /** Poll more often while the harness is busy (embeddings/vision mid-turn). */
  busy?: boolean;
};

export function InferenceUsageBanner({
  vireonConnected,
  managedRoute,
  liveWallet,
  busy = false,
}: Props) {
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const hadVireon = useRef(vireonConnected);

  const load = useCallback(async () => {
    if (!vireonConnected) {
      if (hadVireon.current) {
        hadVireon.current = false;
        setStatus(null);
      }
      return;
    }
    hadVireon.current = true;
    try {
      const r = await webApiFetch(`${WEB_SERVER_BASE}/api/vireon/inference-status`);
      if (!r.ok) return;
      setStatus((await r.json()) as InferenceStatus);
    } catch {
      /* optional */
    }
  }, [vireonConnected]);

  useEffect(() => {
    void load();
    if (!vireonConnected) return;
    const intervalMs = busy && managedRoute ? 30_000 : 60_000;
    const id = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(id);
  }, [vireonConnected, load, busy, managedRoute]);

  const merged: InferenceStatus | null =
    liveWallet != null
      ? {
          ...(status ?? {}),
          entitled: status?.entitled ?? true,
          remainingUsd: liveWallet.remainingUsd ?? status?.remainingUsd ?? null,
          capUsd: liveWallet.capUsd ?? status?.capUsd ?? null,
          usedUsd: liveWallet.usedUsd ?? status?.usedUsd ?? null,
          periodEnd: liveWallet.periodEnd ?? status?.periodEnd ?? null,
        }
      : status;

  if (!vireonConnected || !merged?.entitled) return null;

  const remaining = merged.remainingUsd;
  const cap = merged.capUsd;
  const used = merged.usedUsd;
  const low =
    remaining != null && cap != null && cap > 0 && remaining / cap <= 0.2;
  const exhausted = remaining != null && remaining <= 0.01;

  if (!managedRoute && !exhausted && !low) {
    return (
      <div
        style={{
          margin: "0 12px 8px",
          padding: "8px 12px",
          fontSize: 12,
          borderRadius: 4,
          border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
          background: "rgba(0,20,40,0.6)",
          color: "#a8c4d8",
        }}
      >
        Pro includes managed inference. Settings → inference →{" "}
        <strong>managed</strong> or <strong>auto</strong> to use included credits (Settings → Sign in
        already done).
      </div>
    );
  }

  if (remaining == null) return null;

  const accountUrl = "https://www.vireondynamics.com/account/inference";

  return (
    <div
      style={{
        margin: "0 12px 8px",
        padding: "8px 12px",
        fontSize: 12,
        borderRadius: 4,
        border: exhausted
          ? "1px solid rgba(255,120,80,0.5)"
          : low
            ? "1px solid rgba(255,200,80,0.4)"
            : "1px solid rgba(var(--lim-accent-rgb),0.25)",
        background: exhausted ? "rgba(80,20,10,0.5)" : "rgba(0,20,40,0.6)",
        color: exhausted ? "#ffc8b0" : "#a8c4d8",
      }}
    >
      {managedRoute ? (
        <>
          Managed inference:
          {used != null ? (
            <>
              {" "}
              <strong>${used.toFixed(2)}</strong> used · <strong>${remaining.toFixed(2)}</strong>{" "}
              remaining
            </>
          ) : (
            <>
              {" "}
              <strong>${remaining.toFixed(2)}</strong> remaining
            </>
          )}
          {cap != null ? ` of $${cap.toFixed(2)}` : ""} this period.
        </>
      ) : (
        <>Included inference credits: ${remaining.toFixed(2)} remaining.</>
      )}
      {(low || exhausted) && (
        <>
          {" "}
          <a href={accountUrl} target="_blank" rel="noreferrer" style={{ color: "#7ec8ff" }}>
            {exhausted ? "Add credits" : "Top up credits"}
          </a>
        </>
      )}
      {exhausted && managedRoute && (
        <span style={{ display: "block", marginTop: 4, opacity: 0.9 }}>
          Or switch Settings → inference → <strong>byok</strong> to use your own API key.
        </span>
      )}
    </div>
  );
}
