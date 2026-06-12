import {
  buildCloudJoinUrl,
  defaultVireonRemoteJoinOrigin,
  ENTITLEMENTS,
  hasEntitlement,
  resolveEntitlements,
  resolveLicenseTokenForHarness,
  type RemoteSessionMode,
} from "@liminal/core";

export interface CloudRemoteRegistration {
  joinCode: string;
  cloudUrl: string;
  relayHostUrl: string;
  relayGuestUrl: string;
}

/** Register a remote session with the Vireon relay (Pro). */
export async function registerCloudRemoteSession(opts: {
  chatId: string;
  mode: RemoteSessionMode;
  joinCode: string;
  joinToken: string;
}): Promise<CloudRemoteRegistration | null> {
  const license = (await resolveLicenseTokenForHarness())?.trim();
  if (!license) return null;

  const entitlements = resolveEntitlements({ token: license });
  if (!hasEntitlement(entitlements, ENTITLEMENTS.PRO_REMOTE_SESSIONS)) {
    return null;
  }

  const origin = defaultVireonRemoteJoinOrigin();

  const res = await fetch(`${origin}/api/remote/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${license}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      chatId: opts.chatId,
      mode: opts.mode,
      joinCode: opts.joinCode,
      joinToken: opts.joinToken,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    joinCode?: string;
    relayHostUrl?: string;
    relayGuestUrl?: string;
  };

  if (!res.ok) {
    throw new Error(body.error ?? `Cloud remote registration failed (${res.status})`);
  }

  const code = body.joinCode ?? opts.joinCode;
  return {
    joinCode: code,
    cloudUrl: buildCloudJoinUrl({ joinCode: code, origin }),
    relayHostUrl: body.relayHostUrl ?? "",
    relayGuestUrl: body.relayGuestUrl ?? "",
  };
}

/** Best-effort forward of protocol frames to the Vireon cloud relay (SSE buffer). */
export class CloudRelayForwarder {
  private relay: { url: string; joinCode: string; joinToken: string } | null = null;

  setRelay(opts: { relayHostUrl: string; joinCode: string; joinToken: string }): void {
    const url = opts.relayHostUrl.trim();
    if (!url) {
      this.relay = null;
      return;
    }
    this.relay = {
      url,
      joinCode: opts.joinCode.toUpperCase(),
      joinToken: opts.joinToken,
    };
  }

  clear(): void {
    this.relay = null;
  }

  forward(frameJson: string): void {
    const relay = this.relay;
    if (!relay) return;
    void fetch(relay.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${relay.joinToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ joinCode: relay.joinCode, frame: frameJson }),
    }).catch(() => {
      /* relay is best-effort */
    });
  }

  forwardUiFrame(opts: {
    jpegBase64: string;
    width: number;
    height: number;
    windowId?: string;
    title?: string;
    seq?: number;
  }): void {
    const relay = this.relay;
    if (!relay) return;
    void fetch(relay.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${relay.joinToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        joinCode: relay.joinCode,
        frame: JSON.stringify({
          kind: "ui",
          b64: opts.jpegBase64,
          w: opts.width,
          h: opts.height,
          windowId: opts.windowId,
          title: opts.title,
          seq: opts.seq,
        }),
      }),
    }).catch(() => {
      /* relay is best-effort */
    });
  }

  async pollInputs(joinCode: string, joinToken: string): Promise<unknown[]> {
    const relay = this.relay;
    if (!relay) return [];
    const origin = new URL(relay.url).origin;
    const res = await fetch(
      `${origin}/api/remote/input/poll?join=${encodeURIComponent(joinCode)}`,
      {
        headers: { Authorization: `Bearer ${joinToken}` },
      }
    ).catch(() => null);
    if (!res?.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { events?: unknown[] };
    return Array.isArray(body.events) ? body.events : [];
  }
}
